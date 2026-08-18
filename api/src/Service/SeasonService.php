<?php

declare(strict_types=1);

namespace Pina\Service;

use Pina\Auth\Identity;
use Pina\Auth\Role;
use Pina\Auth\TeamScope;
use Pina\Http\ApiException;
use Pina\Support\Database;

/**
 * Sezóny a jejich soupisky.
 *
 * Sezóna je jednotka, ke které se váže sazebník, prohřešky i docházka. Uzavřená
 * sezóna je jen ke čtení — proto zápisy chodí přes TeamScope::writableSeason().
 *
 * @phpstan-type SeasonPayload array{
 *     id:int,
 *     teamId:int,
 *     name:string,
 *     startsOn:string,
 *     endsOn:string,
 *     halfYearOn:string|null,
 *     isCurrent:bool,
 *     closedAt:string|null,
 *     rosterCount:int
 * }
 * @phpstan-type RosterEntry array{
 *     membershipId:int,
 *     userId:int,
 *     name:string,
 *     avatarUrl:string|null,
 *     role:string,
 *     status:string,
 *     jerseyNumber:int|null,
 *     paymentReference:string
 * }
 */
final class SeasonService
{
    public function __construct(
        private readonly Database $db,
        private readonly TeamScope $scope,
    ) {
    }

    /**
     * Hráč vidí jen sezóny, kde je/byl na soupisce nebo má zápis.
     * Pínař a admin vidí všechno.
     *
     * @return list<SeasonPayload>
     */
    public function forTeam(Identity $identity, int $teamId): array
    {
        $this->scope->team($identity, $teamId, Role::Player);

        $rows = $this->db->all(
            'SELECT s.id, s.team_id, s.name, s.starts_on, s.ends_on, s.half_year_on, s.is_current, s.closed_at,
                    (SELECT COUNT(*) FROM roster_entry r WHERE r.season_id = s.id AND r.active = 1) AS roster_count
               FROM season s
              WHERE s.team_id = ?
                AND (
                    ? = 1
                    OR EXISTS (
                        SELECT 1 FROM roster_entry r
                          JOIN membership m ON m.id = r.membership_id
                         WHERE r.season_id = s.id AND r.active = 1 AND m.user_id = ?
                    )
                    OR EXISTS (
                        SELECT 1 FROM offence_record o
                          JOIN membership m ON m.id = o.membership_id
                         WHERE o.season_id = s.id AND o.voided_at IS NULL AND m.user_id = ?
                    )
                )
              ORDER BY s.starts_on DESC, s.id DESC',
            [
                $teamId,
                $this->managesTeam($identity, $teamId) ? 1 : 0,
                $identity->userId,
                $identity->userId,
            ],
        );

        return array_map($this->mapSeason(...), $rows);
    }

    /**
     * Role se čte z databáze, ne z tokenu — odebrané oprávnění platí hned.
     */
    private function managesTeam(Identity $identity, int $teamId): bool
    {
        $role = $this->db->value(
            "SELECT role FROM membership WHERE team_id = ? AND user_id = ? AND status <> 'left'",
            [$teamId, $identity->userId],
        );

        return Role::tryFrom((string) $role)?->allows(Role::Treasurer) ?? false;
    }

    /**
     * @return SeasonPayload
     */
    public function create(Identity $identity, int $teamId, string $name, string $startsOn, string $endsOn): array
    {
        $this->scope->team($identity, $teamId, Role::Admin);

        $this->assertPeriod($startsOn, $endsOn);

        $duplicate = $this->db->value(
            'SELECT id FROM season WHERE team_id = ? AND name = ?',
            [$teamId, $name],
        );

        if ($duplicate !== null) {
            throw ApiException::conflict(
                'SEASON_EXISTS',
                'Sezóna s tímto názvem už v družstvu existuje.',
                ['field' => 'name'],
            );
        }

        $halfYearOn = self::defaultHalfYear($startsOn, $endsOn);

        $seasonId = $this->db->transaction(function () use ($teamId, $name, $startsOn, $endsOn, $halfYearOn): int {
            // Aktuální sezóna smí být v družstvu jen jedna, jinak by aplikace
            // nevěděla, do které zapisovat prohřešky.
            $this->db->run('UPDATE season SET is_current = 0 WHERE team_id = ?', [$teamId]);

            $this->db->run(
                'INSERT INTO season (team_id, name, starts_on, ends_on, half_year_on, is_current)
                 VALUES (?, ?, ?, ?, ?, 1)',
                [$teamId, $name, $startsOn, $endsOn, $halfYearOn],
            );

            return $this->db->lastInsertId();
        });

        return $this->detail($seasonId);
    }

    /**
     * @param  array{name?:string,startsOn?:string,endsOn?:string,halfYearOn?:string|null} $changes
     * @return SeasonPayload
     */
    public function update(Identity $identity, int $seasonId, array $changes): array
    {
        // writableSeason odmítne uzavřenou sezónu s 409, cizí s 404.
        $teamId = $this->scope->writableSeason($identity, $seasonId, Role::Admin);

        if ($changes === []) {
            throw ApiException::validation('Není co upravit — pošlete alespoň jedno pole.');
        }

        $current = $this->db->first(
            'SELECT name, starts_on, ends_on, half_year_on FROM season WHERE id = ?',
            [$seasonId],
        );

        if ($current === null) {
            throw ApiException::notFound();
        }

        $name     = $changes['name'] ?? (string) $current['name'];
        $startsOn = $changes['startsOn'] ?? (string) $current['starts_on'];
        $endsOn   = $changes['endsOn'] ?? (string) $current['ends_on'];

        $stored     = $current['half_year_on'] === null ? null : (string) $current['half_year_on'];
        $halfYearOn = array_key_exists('halfYearOn', $changes) ? $changes['halfYearOn'] : $stored;

        $this->assertPeriod($startsOn, $endsOn);
        $this->assertHalfYear($halfYearOn, $startsOn, $endsOn);

        if ($name !== (string) $current['name']) {
            $duplicate = $this->db->value(
                'SELECT id FROM season WHERE team_id = ? AND name = ? AND id <> ?',
                [$teamId, $name, $seasonId],
            );

            if ($duplicate !== null) {
                throw ApiException::conflict(
                    'SEASON_EXISTS',
                    'Sezóna s tímto názvem už v družstvu existuje.',
                    ['field' => 'name'],
                );
            }
        }

        $this->db->run(
            'UPDATE season SET name = ?, starts_on = ?, ends_on = ?, half_year_on = ? WHERE id = ?',
            [$name, $startsOn, $endsOn, $halfYearOn, $seasonId],
        );

        return $this->detail($seasonId);
    }

    /**
     * writableSeason() zabrání znovu uzavřít.
     *
     * @return SeasonPayload
     */
    public function close(Identity $identity, int $seasonId): array
    {
        $this->scope->writableSeason($identity, $seasonId, Role::Admin);

        $this->db->run('UPDATE season SET closed_at = NOW() WHERE id = ?', [$seasonId]);

        return $this->detail($seasonId);
    }

    /**
     * @return list<RosterEntry>
     */
    public function roster(Identity $identity, int $seasonId): array
    {
        $this->scope->season($identity, $seasonId, Role::Player);

        return $this->rosterEntries($seasonId);
    }

    /**
     * Soupiska se negeneruje, jen se přepíná active — smazání by rozbilo historii.
     *
     * @param  list<int> $membershipIds
     * @return list<RosterEntry>
     */
    public function setRoster(Identity $identity, int $seasonId, array $membershipIds): array
    {
        $teamId = $this->scope->writableSeason($identity, $seasonId, Role::Treasurer);

        $ids = array_values(array_unique($membershipIds));

        if ($ids !== []) {
            // Placeholdery vznikají jen z počtu prvků; samotná ID jdou parametry.
            $placeholders = implode(',', array_fill(0, count($ids), '?'));

            $found = $this->db->all(
                "SELECT id FROM membership WHERE team_id = ? AND id IN ($placeholders)",
                [$teamId, ...$ids],
            );

            if (count($found) !== count($ids)) {
                throw ApiException::validation(
                    'Soupiska obsahuje člena, který do družstva nepatří.',
                    ['field' => 'membershipIds'],
                );
            }
        }

        $this->db->transaction(function () use ($seasonId, $ids): int {
            $this->db->run('UPDATE roster_entry SET active = 0 WHERE season_id = ?', [$seasonId]);

            foreach ($ids as $membershipId) {
                $this->db->run(
                    'INSERT INTO roster_entry (season_id, membership_id, active) VALUES (?, ?, 1)
                     ON DUPLICATE KEY UPDATE active = 1',
                    [$seasonId, $membershipId],
                );
            }

            return count($ids);
        });

        return $this->rosterEntries($seasonId);
    }

    /**
     * @return SeasonPayload
     */
    private function detail(int $seasonId): array
    {
        $row = $this->db->first(
            'SELECT s.id, s.team_id, s.name, s.starts_on, s.ends_on, s.half_year_on, s.is_current, s.closed_at,
                    (SELECT COUNT(*) FROM roster_entry r WHERE r.season_id = s.id AND r.active = 1) AS roster_count
               FROM season s
              WHERE s.id = ?',
            [$seasonId],
        );

        if ($row === null) {
            throw ApiException::notFound();
        }

        return $this->mapSeason($row);
    }

    /**
     * @param  array<string,mixed> $row
     * @return SeasonPayload
     */
    private function mapSeason(array $row): array
    {
        return [
            'id'          => (int) $row['id'],
            'teamId'      => (int) $row['team_id'],
            'name'        => (string) $row['name'],
            'startsOn'    => (string) $row['starts_on'],
            'endsOn'      => (string) $row['ends_on'],
            'halfYearOn'  => $row['half_year_on'] === null ? null : (string) $row['half_year_on'],
            'isCurrent'   => (bool) $row['is_current'],
            'closedAt'    => $row['closed_at'] === null ? null : (string) $row['closed_at'],
            'rosterCount' => (int) $row['roster_count'],
        ];
    }

    /**
     * @return list<RosterEntry>
     */
    private function rosterEntries(int $seasonId): array
    {
        $rows = $this->db->all(
            'SELECT r.membership_id, m.user_id, m.role, m.status, m.jersey_number, m.payment_reference,
                    u.display_name, u.avatar_url
               FROM roster_entry r
               JOIN membership m ON m.id = r.membership_id
               JOIN `user` u ON u.id = m.user_id
              WHERE r.season_id = ? AND r.active = 1
              ORDER BY u.display_name',
            [$seasonId],
        );

        return array_map(static fn (array $row): array => [
            'membershipId'     => (int) $row['membership_id'],
            'userId'           => (int) $row['user_id'],
            'name'             => (string) $row['display_name'],
            'avatarUrl'        => $row['avatar_url'] === null ? null : (string) $row['avatar_url'],
            'role'             => (string) $row['role'],
            'status'           => (string) $row['status'],
            'jerseyNumber'     => $row['jersey_number'] === null ? null : (int) $row['jersey_number'],
            'paymentReference' => (string) $row['payment_reference'],
        ], $rows);
    }

    private function assertPeriod(string $startsOn, string $endsOn): void
    {
        if ($startsOn >= $endsOn) {
            throw ApiException::validation(
                'Začátek sezóny musí být dřív než konec.',
                ['field' => 'startsOn'],
            );
        }
    }

    /**
     * Přelom pololetí musí ležet uvnitř sezóny — na jejím okraji by jedna
     * polovina zůstala prázdná a členění by nic neříkalo.
     */
    private function assertHalfYear(?string $halfYearOn, string $startsOn, string $endsOn): void
    {
        if ($halfYearOn === null) {
            return;
        }

        if ($halfYearOn <= $startsOn || $halfYearOn > $endsOn) {
            throw ApiException::validation(
                'Přelom pololetí musí padnout do sezóny, ne na její začátek ani za konec.',
                ['field' => 'halfYearOn'],
            );
        }
    }

    /**
     * Volejbalová sezóna běží přes Nový rok, takže přelom pololetí je skoro
     * vždycky 1. ledna. Předvyplní se sám a pínař ho může přepsat; když sezóna
     * žádný Nový rok neobsahuje, pololetí se neřeší.
     */
    public static function defaultHalfYear(string $startsOn, string $endsOn): ?string
    {
        $year      = (int) substr($startsOn, 0, 4);
        $candidate = sprintf('%04d-01-01', $year + 1);

        if ($candidate > $startsOn && $candidate <= $endsOn) {
            return $candidate;
        }

        // Sezóna začínající v lednu má Nový rok až ten příští, ale jen když dosáhne.
        $sameYear = sprintf('%04d-01-01', $year);

        return $sameYear > $startsOn && $sameYear <= $endsOn ? $sameYear : null;
    }
}
