<?php

declare(strict_types=1);

namespace Pina\Service;

use DateTimeImmutable;
use Pina\Auth\Identity;
use Pina\Auth\Role;
use Pina\Auth\TeamScope;
use Pina\Http\ApiException;
use Pina\Support\CzechBankAccount;
use Pina\Support\Database;

/** Platby, cestovní náhrady a platební QR nad jedním finančním kontem hráče. */
final class FinanceService
{
    private const PAYMENT_METHODS = ['cash', 'transfer', 'qr'];

    private readonly FinancialAccess $access;
    private readonly AttendanceModule $attendance;
    private readonly AuditLog $audit;

    public function __construct(
        private readonly Database $db,
        private readonly TeamScope $scope,
        ?FinancialAccess $access = null,
        ?AuditLog $audit = null,
        ?AttendanceModule $attendance = null,
    ) {
        $this->access     = $access ?? new FinancialAccess($db);
        $this->audit      = $audit ?? new AuditLog($db, $scope);
        $this->attendance = $attendance ?? new AttendanceModule($db);
    }

    /** @return array{items:list<array<string,mixed>>} */
    public function payments(
        Identity $identity,
        int $seasonId,
        ?int $membershipId = null,
        bool $includeVoided = false,
    ): array {
        $teamId       = $this->scope->season($identity, $seasonId, Role::Player);
        $membershipId = $this->visibleMembership($identity, $teamId, $membershipId);

        $where  = ['p.season_id = ?'];
        $params = [$seasonId];
        if ($membershipId !== null) {
            $where[]  = 'p.membership_id = ?';
            $params[] = $membershipId;
        }
        if (!$includeVoided) {
            $where[] = 'p.voided_at IS NULL';
        }

        $rows = $this->db->all(
            'SELECT p.*, u.display_name AS member_name, u.avatar_url AS member_avatar_url,
                    confirmer.display_name AS confirmer_name
               FROM payment p
               JOIN membership m ON m.id = p.membership_id
               JOIN `user` u ON u.id = m.user_id
               LEFT JOIN `user` confirmer ON confirmer.id = p.confirmed_by
              WHERE ' . implode(' AND ', $where) . '
              ORDER BY p.paid_on DESC, p.id DESC',
            $params,
        );

        return ['items' => array_map($this->paymentPayload(...), $rows)];
    }

    /**
     * @param array{membershipId:int,amountCzk:int,paidOn:string,method:string,note:string|null} $input
     * @return array<string,mixed>
     */
    public function createPayment(Identity $identity, int $seasonId, array $input): array
    {
        $teamId = $this->scope->writableSeason($identity, $seasonId, Role::Treasurer);
        $this->assertMembership($teamId, $input['membershipId']);
        $this->assertDate($input['paidOn'], 'paidOn');

        if ($input['amountCzk'] <= 0) {
            throw ApiException::validation('Platba musí být vyšší než nula.', ['field' => 'amountCzk']);
        }
        if (!in_array($input['method'], self::PAYMENT_METHODS, true)) {
            throw ApiException::validation('Neznámý způsob platby.', ['field' => 'method']);
        }

        $reference = $this->db->value('SELECT payment_reference FROM membership WHERE id = ?', [$input['membershipId']]);

        $this->db->run(
            'INSERT INTO payment
                 (season_id, membership_id, amount_czk, paid_on, method, variable_symbol, note, confirmed_by)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
            [
                $seasonId,
                $input['membershipId'],
                $input['amountCzk'],
                $input['paidOn'],
                $input['method'],
                $reference,
                $input['note'],
                $identity->userId,
            ],
        );

        return $this->payment($this->db->lastInsertId());
    }

    /** @return array<string,mixed> */
    public function voidPayment(Identity $identity, int $paymentId, string $reason): array
    {
        $reason = trim($reason);
        if ($reason === '') {
            throw ApiException::validation('Uveďte důvod storna platby.', ['field' => 'reason']);
        }
        if (mb_strlen($reason) > 500) {
            throw ApiException::validation('Důvod storna může mít nejvýše 500 znaků.', ['field' => 'reason']);
        }

        $row = $this->db->first(
            'SELECT season_id, membership_id, amount_czk FROM payment WHERE id = ?',
            [$paymentId],
        );
        if ($row === null) {
            throw ApiException::notFound();
        }

        $teamId = $this->scope->writableSeason($identity, (int) $row['season_id'], Role::Treasurer);

        $this->db->transaction(function () use ($identity, $paymentId, $reason, $row, $teamId): void {
            $changed = $this->db->run(
                'UPDATE payment SET voided_at = NOW() WHERE id = ? AND voided_at IS NULL',
                [$paymentId],
            )->rowCount();

            if ($changed === 0) {
                return;
            }

            $this->audit->record($identity, $teamId, 'voided', 'payment', $paymentId, [
                'amountCzk'    => (int) $row['amount_czk'],
                'reason'       => $reason,
                'membershipId' => (int) $row['membership_id'],
            ]);
        });

        return $this->payment($paymentId);
    }

    /** @return array{items:list<array<string,mixed>>} */
    public function travelClaims(
        Identity $identity,
        int $seasonId,
        ?int $membershipId = null,
        bool $includeVoided = false,
    ): array {
        $teamId       = $this->scope->season($identity, $seasonId, Role::Player);
        $membershipId = $this->visibleMembership($identity, $teamId, $membershipId);

        $where  = ['tc.season_id = ?'];
        $params = [$seasonId];
        if ($membershipId !== null) {
            $where[]  = 'tc.membership_id = ?';
            $params[] = $membershipId;
        }
        if (!$includeVoided) {
            $where[] = 'tc.voided_at IS NULL';
        }

        $rows = $this->db->all(
            'SELECT tc.*, u.display_name AS member_name, u.avatar_url AS member_avatar_url, e.title AS event_title
               FROM travel_claim tc
               JOIN membership m ON m.id = tc.membership_id
               JOIN `user` u ON u.id = m.user_id
               LEFT JOIN event e ON e.id = tc.event_id
              WHERE ' . implode(' AND ', $where) . '
              ORDER BY tc.occurred_on DESC, tc.id DESC',
            $params,
        );

        return ['items' => array_map($this->travelPayload(...), $rows)];
    }

    /**
     * Doplní nároky z proběhlých venkovních zápasů. Již zúčtované řádky jsou
     * nedotknutelné; změna řidiče opraví jen dosud otevřený nárok.
     *
     * @return array{created:int,updated:int,voided:int,items:list<array<string,mixed>>}
     */
    public function syncTravelClaims(Identity $identity, int $seasonId): array
    {
        $teamId = $this->scope->writableSeason($identity, $seasonId, Role::Treasurer);
        $this->attendance->assertEnabled($teamId);
        $settings = $this->travelSettings($teamId);

        if (!$settings['enabled']) {
            $items = $this->travelClaims($identity, $seasonId)['items'];

            return ['created' => 0, 'updated' => 0, 'voided' => 0, 'items' => $items];
        }

        // Domácí hala se srovnává proti location_id, ne proti distance_km: vzdálenost
        // může ve sloupci zůstat z doby, kdy hala ještě nebyla nastavená, a cesťák
        // do vlastní haly nikdy nevzniká.
        $drivers = $this->db->all(
            "SELECT e.id AS event_id, ep.membership_id, DATE(e.starts_at) AS occurred_on, e.distance_km
               FROM event e
               JOIN event_participant ep ON ep.event_id = e.id
              WHERE e.season_id = ? AND e.type = 'match' AND e.status <> 'cancelled'
                AND e.starts_at <= NOW() AND e.distance_km IS NOT NULL AND e.distance_km > 0
                AND (? IS NULL OR e.location_id IS NULL OR e.location_id <> ?)
                AND ep.transport = 'driver' AND ep.rsvp = 'yes'
                AND (ep.attendance IS NULL OR ep.attendance = 'present')",
            [$seasonId, $settings['homeLocationId'], $settings['homeLocationId']],
        );

        // Stornované nároky se čtou taky, aby je sync nezaložil znovu.
        // Řazení dá otevřenému řádku přednost, pokud jich u termínu leží víc.
        $existingRows = $this->db->all(
            'SELECT id, event_id, membership_id, distance_km, rate_czk_km, amount_czk, voided_at
               FROM travel_claim
              WHERE season_id = ? AND event_id IS NOT NULL
              ORDER BY voided_at IS NULL, id',
            [$seasonId],
        );
        $existing = [];
        foreach ($existingRows as $row) {
            $existing[(int) $row['event_id'] . ':' . (int) $row['membership_id']] = $row;
        }

        $changes = $this->db->transaction(function () use (
            $drivers,
            $existing,
            $settings,
            $seasonId,
            $identity,
            $teamId,
        ): array {
            $created    = 0;
            $updated    = 0;
            $activeKeys = [];

            foreach ($drivers as $driver) {
                $eventId          = (int) $driver['event_id'];
                $membershipId     = (int) $driver['membership_id'];
                $key              = $eventId . ':' . $membershipId;
                $activeKeys[$key] = true;
                $distance         = (int) $driver['distance_km'] * ($settings['roundTrip'] ? 2 : 1);
                $current          = $existing[$key] ?? null;

                if ($current === null) {
                    $amount = (int) round($distance * $settings['rate']);
                    $this->db->run(
                        'INSERT INTO travel_claim
                         (season_id, membership_id, event_id, occurred_on, distance_km, rate_czk_km,
                          amount_czk, created_by)
                     VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
                        [
                            $seasonId, $membershipId, $eventId, $driver['occurred_on'], $distance,
                            number_format($settings['rate'], 2, '.', ''), $amount, $identity->userId,
                        ],
                    );
                    $created++;
                    continue;
                }

                // Storno je rozhodnutí pínaře, sync ho nevrací.
                if ($current['voided_at'] !== null) {
                    continue;
                }

                $rate   = (float) $current['rate_czk_km'];
                $amount = (int) round($distance * $rate);
                if ((int) $current['distance_km'] !== $distance) {
                    $this->db->run(
                        'UPDATE travel_claim SET distance_km = ?, amount_czk = ? WHERE id = ?',
                        [$distance, $amount, (int) $current['id']],
                    );
                    $updated++;
                }
            }

            $voided = 0;
            foreach ($existing as $key => $row) {
                if (isset($activeKeys[$key]) || $row['voided_at'] !== null) {
                    continue;
                }

                $claimId = (int) $row['id'];
                $this->db->run('UPDATE travel_claim SET voided_at = NOW() WHERE id = ?', [$claimId]);
                $this->audit->record($identity, $teamId, 'voided', 'travel_claim', $claimId, [
                    'amountCzk'    => (int) $row['amount_czk'],
                    'eventId'      => $row['event_id'] === null ? null : (int) $row['event_id'],
                    'membershipId' => (int) $row['membership_id'],
                ]);
                $voided++;
            }

            return compact('created', 'updated', 'voided');
        });

        $items = $this->travelClaims($identity, $seasonId)['items'];

        return [...$changes, 'items' => $items];
    }

    /**
     * Ruční cesťák pro výjimky, například turnaj mimo kalendář.
     *
     * @param array{membershipId:int,occurredOn:string,distanceKm:int,note:string|null} $input
     * @return array<string,mixed>
     */
    public function createTravelClaim(Identity $identity, int $seasonId, array $input): array
    {
        $teamId   = $this->scope->writableSeason($identity, $seasonId, Role::Treasurer);
        $settings = $this->travelSettings($teamId);
        if (!$settings['enabled']) {
            throw ApiException::conflict('TRAVEL_DISABLED', 'Cesťáky nejsou pro družstvo zapnuté.');
        }

        $this->assertMembership($teamId, $input['membershipId']);
        $this->assertDate($input['occurredOn'], 'occurredOn');
        if ($input['distanceKm'] <= 0 || $input['distanceKm'] > 65535) {
            throw ApiException::validation('Vzdálenost musí být mezi 1 a 65 535 km.', ['field' => 'distanceKm']);
        }

        $distance = $input['distanceKm'] * ($settings['roundTrip'] ? 2 : 1);
        if ($distance > 65535) {
            throw ApiException::validation('Celková proplácená vzdálenost je příliš vysoká.', ['field' => 'distanceKm']);
        }
        $amount = (int) round($distance * $settings['rate']);

        $this->db->run(
            'INSERT INTO travel_claim
                 (season_id, membership_id, occurred_on, distance_km, rate_czk_km, amount_czk, note, created_by)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
            [
                $seasonId, $input['membershipId'], $input['occurredOn'], $distance,
                number_format($settings['rate'], 2, '.', ''), $amount, $input['note'], $identity->userId,
            ],
        );

        return $this->travelClaim($this->db->lastInsertId());
    }

    /** @return array<string,mixed> */
    public function voidTravelClaim(Identity $identity, int $claimId): array
    {
        $row = $this->db->first(
            'SELECT season_id, membership_id, event_id, amount_czk FROM travel_claim WHERE id = ?',
            [$claimId],
        );
        if ($row === null) {
            throw ApiException::notFound();
        }

        $teamId = $this->scope->writableSeason($identity, (int) $row['season_id'], Role::Treasurer);

        $this->db->transaction(function () use ($claimId, $identity, $row, $teamId): void {
            $changed = $this->db->run(
                'UPDATE travel_claim SET voided_at = NOW() WHERE id = ? AND voided_at IS NULL',
                [$claimId],
            )->rowCount();

            if ($changed === 0) {
                return;
            }

            $this->audit->record($identity, $teamId, 'voided', 'travel_claim', $claimId, [
                'amountCzk'    => (int) $row['amount_czk'],
                'eventId'      => $row['event_id'] === null ? null : (int) $row['event_id'],
                'membershipId' => (int) $row['membership_id'],
            ]);
        });

        return $this->travelClaim($claimId);
    }

    /** @return array<string,mixed> */
    public function paymentQr(Identity $identity, int $seasonId, int $membershipId): array
    {
        $teamId = $this->scope->season($identity, $seasonId, Role::Player);
        if ($this->scope->membership($identity, $membershipId, Role::Player) !== $teamId) {
            throw ApiException::notFound();
        }

        // Cizí QR smí připravit pínař, hráč vždy jen své.
        $this->scope->ownMembershipOr($identity, $membershipId, Role::Treasurer);

        $row = $this->db->first(
            'SELECT s.name AS season_name, s.starts_on, s.ends_on, s.half_year_on,
                    t.name AS team_name, ts.bank_account, m.payment_reference
               FROM season s
               JOIN team t ON t.id = s.team_id
               LEFT JOIN team_settings ts ON ts.team_id = t.id
               JOIN membership m ON m.id = ? AND m.team_id = t.id
              WHERE s.id = ?',
            [$membershipId, $seasonId],
        );
        if ($row === null) {
            throw ApiException::notFound();
        }

        $period = $this->currentPeriod(
            $row['half_year_on'] === null ? null : (string) $row['half_year_on'],
            (string) $row['starts_on'],
            (string) $row['ends_on'],
            (string) $row['season_name'],
        );
        // QR vždy dorovnává celý dosud neuhrazený zůstatek sezóny — musí to být do
        // koruny stejné číslo, jaké hráč vidí na kontě, jinak si po zaplacení nebude
        // vědět rady. Období určuje jen název platby a rytmus zúčtování; datum zápisu
        // se nefiltruje, protože klidně padne mimo rozsah sezóny (turnaj před startem).
        $amount = $this->seasonBalance($seasonId, $membershipId);
        // Družstvo bez uloženého nastavení řádek nemá, proto LEFT JOIN a NULL.
        $account = $row['bank_account'] === null ? null : (string) $row['bank_account'];
        $spayd   = null;

        if ($account !== null && $amount > 0) {
            $message = $this->spaydText('Pina ' . (string) $row['team_name'] . ' ' . $period['name']);
            $spayd   = sprintf(
                'SPD*1.0*ACC:%s*AM:%d.00*CC:CZK*X-VS:%s*MSG:%s',
                CzechBankAccount::iban($account),
                $amount,
                (string) $row['payment_reference'],
                $message,
            );
        }

        return [
            'membershipId'   => $membershipId,
            'amountCzk'      => max(0, $amount),
            'variableSymbol' => (string) $row['payment_reference'],
            'bankAccount'    => $account,
            'spayd'          => $spayd,
            'period'         => $period,
        ];
    }

    private function visibleMembership(Identity $identity, int $teamId, ?int $membershipId): ?int
    {
        $restricted = $this->access->restrictedToMembership($identity, $teamId);
        if ($restricted !== null) {
            if ($membershipId !== null && $membershipId !== $restricted) {
                throw ApiException::notFound();
            }

            return $restricted;
        }

        if ($membershipId !== null) {
            $this->assertMembership($teamId, $membershipId);
        }

        return $membershipId;
    }

    private function assertMembership(int $teamId, int $membershipId): void
    {
        $found = $this->db->value('SELECT id FROM membership WHERE id = ? AND team_id = ?', [$membershipId, $teamId]);
        if ($found === null) {
            throw ApiException::notFound();
        }
    }

    private function assertDate(string $date, string $field): void
    {
        $parsed = DateTimeImmutable::createFromFormat('!Y-m-d', $date);
        if (!$parsed instanceof DateTimeImmutable || $parsed->format('Y-m-d') !== $date) {
            throw ApiException::validation('Datum musí být ve tvaru RRRR-MM-DD.', ['field' => $field]);
        }
    }

    /** @return array{enabled:bool,rate:float,roundTrip:bool,homeLocationId:int|null} */
    private function travelSettings(int $teamId): array
    {
        $row = $this->db->first(
            'SELECT travel_enabled, travel_rate_czk_km, travel_round_trip, home_location_id
               FROM team_settings WHERE team_id = ?',
            [$teamId],
        );
        $home = $row['home_location_id'] ?? null;

        return [
            'enabled'        => (bool) ($row['travel_enabled'] ?? false),
            'rate'           => (float) ($row['travel_rate_czk_km'] ?? 5.0),
            'roundTrip'      => (bool) ($row['travel_round_trip'] ?? true),
            'homeLocationId' => $home === null ? null : (int) $home,
        ];
    }

    /** @return array<string,mixed> */
    private function payment(int $paymentId): array
    {
        $row = $this->db->first(
            'SELECT p.*, u.display_name AS member_name, u.avatar_url AS member_avatar_url,
                    confirmer.display_name AS confirmer_name
               FROM payment p
               JOIN membership m ON m.id = p.membership_id
               JOIN `user` u ON u.id = m.user_id
               LEFT JOIN `user` confirmer ON confirmer.id = p.confirmed_by
              WHERE p.id = ?',
            [$paymentId],
        );

        return $row === null ? throw ApiException::notFound() : $this->paymentPayload($row);
    }

    /**
     * @param  array<string,mixed> $row
     * @return array{
     *     id:int,seasonId:int,membershipId:int,memberName:string,amountCzk:int,paidOn:string,
     *     method:string,variableSymbol:string|null,note:string|null,
     *     confirmedBy:array{id:int,name:string}|null,createdAt:string,voidedAt:string|null
     * }
     */
    private function paymentPayload(array $row): array
    {
        return [
            'id'              => (int) $row['id'],
            'seasonId'        => (int) $row['season_id'],
            'membershipId'    => (int) $row['membership_id'],
            'memberName'      => (string) $row['member_name'],
            'memberAvatarUrl' => $row['member_avatar_url'] === null ? null : (string) $row['member_avatar_url'],
            'amountCzk'       => (int) $row['amount_czk'],
            'paidOn'          => (string) $row['paid_on'],
            'method'          => (string) $row['method'],
            'variableSymbol'  => $row['variable_symbol'] === null ? null : (string) $row['variable_symbol'],
            'note'            => $row['note'] === null ? null : (string) $row['note'],
            'confirmedBy'     => $row['confirmed_by'] === null ? null : [
                'id'   => (int) $row['confirmed_by'],
                'name' => (string) $row['confirmer_name'],
            ],
            'createdAt' => (string) $row['created_at'],
            'voidedAt'  => $row['voided_at'] === null ? null : (string) $row['voided_at'],
        ];
    }

    /** @return array<string,mixed> */
    private function travelClaim(int $claimId): array
    {
        $row = $this->db->first(
            'SELECT tc.*, u.display_name AS member_name, u.avatar_url AS member_avatar_url, e.title AS event_title
               FROM travel_claim tc
               JOIN membership m ON m.id = tc.membership_id
               JOIN `user` u ON u.id = m.user_id
               LEFT JOIN event e ON e.id = tc.event_id
              WHERE tc.id = ?',
            [$claimId],
        );

        return $row === null ? throw ApiException::notFound() : $this->travelPayload($row);
    }

    /**
     * @param  array<string,mixed> $row
     * @return array{
     *     id:int,seasonId:int,membershipId:int,memberName:string,eventId:int|null,eventTitle:string|null,
     *     occurredOn:string,distanceKm:int,rateCzkKm:float,amountCzk:int,
     *     note:string|null,createdAt:string,voidedAt:string|null
     * }
     */
    private function travelPayload(array $row): array
    {
        return [
            'id'              => (int) $row['id'],
            'seasonId'        => (int) $row['season_id'],
            'membershipId'    => (int) $row['membership_id'],
            'memberName'      => (string) $row['member_name'],
            'memberAvatarUrl' => $row['member_avatar_url'] === null ? null : (string) $row['member_avatar_url'],
            'eventId'         => $row['event_id'] === null ? null : (int) $row['event_id'],
            'eventTitle'      => $row['event_title'] === null ? null : (string) $row['event_title'],
            'occurredOn'      => (string) $row['occurred_on'],
            'distanceKm'      => (int) $row['distance_km'],
            'rateCzkKm'       => (float) $row['rate_czk_km'],
            'amountCzk'       => (int) $row['amount_czk'],
            'note'            => $row['note'] === null ? null : (string) $row['note'],
            'createdAt'       => (string) $row['created_at'],
            'voidedAt'        => $row['voided_at'] === null ? null : (string) $row['voided_at'],
        ];
    }

    /**
     * Období, do kterého platba spadá. Je to **jen popis** — částka v QR je vždy
     * celý neuhrazený zůstatek sezóny, protože bez uzávěrky nejde poznat, které
     * pololetí měla lednová platba zaplatit. Proto v názvu nestojí „1. pololetí",
     * ale nedoplatek: text nesmí slibovat něco jiného, než co se strhne.
     *
     * @return array{name:string,from:string,to:string,half:'first'|'second'|null}
     */
    private function currentPeriod(?string $boundary, string $startsOn, string $endsOn, string $seasonName): array
    {
        $whole = ['name' => 'Nedoplatek ' . $seasonName, 'from' => $startsOn, 'to' => $endsOn, 'half' => null];

        if ($boundary === null) {
            return $whole;
        }

        $today = (new DateTimeImmutable('today'))->format('Y-m-d');
        if ($today < $startsOn || $today > $endsOn) {
            return $whole;
        }

        $dayBefore = (new DateTimeImmutable($boundary))->modify('-1 day')->format('Y-m-d');

        return $today < $boundary
            ? [...$whole, 'from' => $startsOn, 'to' => $dayBefore, 'half' => 'first']
            : [...$whole, 'from' => $boundary, 'to' => $endsOn, 'half' => 'second'];
    }

    /** Stejný výpočet jako `OffenceService::balances` — obě čísla se musí rovnat. */
    private function seasonBalance(int $seasonId, int $membershipId): int
    {
        $row = $this->db->first(
            'SELECT
                COALESCE((SELECT SUM(amount_czk) FROM offence_record
                           WHERE season_id = ? AND membership_id = ? AND voided_at IS NULL), 0) AS offences,
                COALESCE((SELECT SUM(amount_czk) FROM payment
                           WHERE season_id = ? AND membership_id = ? AND voided_at IS NULL), 0) AS paid,
                COALESCE((SELECT SUM(amount_czk) FROM travel_claim
                           WHERE season_id = ? AND membership_id = ? AND voided_at IS NULL), 0) AS travel',
            [$seasonId, $membershipId, $seasonId, $membershipId, $seasonId, $membershipId],
        );

        return (int) ($row['offences'] ?? 0) - (int) ($row['paid'] ?? 0) - (int) ($row['travel'] ?? 0);
    }

    private function spaydText(string $value): string
    {
        $ascii = iconv('UTF-8', 'ASCII//TRANSLIT//IGNORE', $value);
        $plain = $ascii === false ? $value : $ascii;

        return mb_substr(str_replace(['*', "\n", "\r"], ' ', $plain), 0, 60);
    }
}
