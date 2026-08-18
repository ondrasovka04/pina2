<?php

declare(strict_types=1);

namespace Pina\Tests\Integration;

use Pina\Auth\Identity;
use Pina\Auth\Role;
use Pina\Auth\TeamScope;
use Pina\Http\ApiException;
use Pina\Service\FinanceService;
use Pina\Service\OffenceService;

final class FinanceServiceTest extends DatabaseTestCase
{
    private FinanceService $service;
    private OffenceService $offences;
    private int $club;
    private int $team;
    private int $season;
    private int $playerMembership;
    private int $otherMembership;
    private Identity $player;
    private Identity $treasurer;

    protected function setUp(): void
    {
        parent::setUp();

        $scope          = new TeamScope($this->db);
        $this->service  = new FinanceService($this->db, $scope);
        $this->offences = new OffenceService($this->db, $scope);

        [$this->club, $this->team] = $this->makeTeam('finance', 'Muži A');
        $this->season              = $this->makeSeason($this->team, '2026');
        $this->db->run(
            'UPDATE season SET starts_on = \'2026-01-01\', ends_on = \'2026-12-31\' WHERE id = ?',
            [$this->season],
        );

        $playerId               = $this->makeUser('player@finance.cz');
        $this->playerMembership = $this->makeMembership($playerId, $this->team, 'player');
        $this->player           = new Identity($playerId, 'player@finance.cz', 'Hráč', false, [
            $this->team => Role::Player,
        ]);

        $otherId               = $this->makeUser('other@finance.cz');
        $this->otherMembership = $this->makeMembership($otherId, $this->team, 'player');

        $treasurerId         = $this->makeUser('treasurer@finance.cz');
        $treasurerMembership = $this->makeMembership($treasurerId, $this->team, 'treasurer');
        $this->treasurer     = new Identity($treasurerId, 'treasurer@finance.cz', 'Pínař', false, [
            $this->team => Role::Treasurer,
        ]);

        $this->makeRoster($this->season, [
            $this->playerMembership,
            $this->otherMembership,
            $treasurerMembership,
        ]);
    }

    public function testPaymentReducesBalanceAndVoidRestoresIt(): void
    {
        $this->makeRecord($this->season, $this->playerMembership, 100);

        $payment = $this->service->createPayment($this->treasurer, $this->season, [
            'membershipId' => $this->playerMembership,
            'amountCzk'    => 40,
            'paidOn'       => '2026-09-20',
            'method'       => 'cash',
            'note'         => null,
        ]);

        self::assertSame(40, $payment['amountCzk']);
        self::assertSame(60, $this->balance($this->playerMembership));

        $this->service->voidPayment($this->treasurer, (int) $payment['id']);
        self::assertSame(100, $this->balance($this->playerMembership));
        self::assertSame(1, (int) $this->db->value('SELECT COUNT(*) FROM payment'));
    }

    public function testPlayerCannotConfirmPayment(): void
    {
        $this->expectException(ApiException::class);
        $this->expectExceptionCode(0);

        $this->service->createPayment($this->player, $this->season, [
            'membershipId' => $this->playerMembership,
            'amountCzk'    => 50,
            'paidOn'       => '2026-09-20',
            'method'       => 'transfer',
            'note'         => null,
        ]);
    }

    public function testHiddenPaymentsAreLimitedToOwnMembership(): void
    {
        $this->db->run(
            'INSERT INTO team_settings (team_id, balances_visible_to_players) VALUES (?, 0)',
            [$this->team],
        );
        foreach ([$this->playerMembership, $this->otherMembership] as $membershipId) {
            $this->service->createPayment($this->treasurer, $this->season, [
                'membershipId' => $membershipId,
                'amountCzk'    => 20,
                'paidOn'       => '2026-09-20',
                'method'       => 'cash',
                'note'         => null,
            ]);
        }

        $items = $this->service->payments($this->player, $this->season)['items'];
        self::assertCount(1, $items);
        self::assertSame($this->playerMembership, $items[0]['membershipId']);

        try {
            $this->service->payments($this->player, $this->season, $this->otherMembership);
            self::fail('Cizí platby musí zůstat skryté.');
        } catch (ApiException $e) {
            self::assertSame(404, $e->status);
        }
    }

    public function testManualTravelClaimUsesRateAndRoundTripSnapshot(): void
    {
        $this->db->run(
            'INSERT INTO team_settings (team_id, travel_enabled, travel_rate_czk_km, travel_round_trip)
             VALUES (?, 1, 5.50, 1)',
            [$this->team],
        );

        $claim = $this->service->createTravelClaim($this->treasurer, $this->season, [
            'membershipId' => $this->playerMembership,
            'occurredOn'   => '2026-09-20',
            'distanceKm'   => 10,
            'note'         => 'Turnaj',
        ]);

        self::assertSame(20, $claim['distanceKm']);
        self::assertSame(110, $claim['amountCzk']);
        self::assertSame(-110, $this->balance($this->playerMembership));
    }

    public function testSyncTravelClaimsIsIdempotentAndKeepsRateSnapshot(): void
    {
        $this->db->run(
            'INSERT INTO team_settings (team_id, travel_enabled, travel_rate_czk_km, travel_round_trip)
             VALUES (?, 1, 5.00, 1)',
            [$this->team],
        );
        $this->db->run(
            "INSERT INTO event (season_id, type, title, starts_at, distance_km, status)
             VALUES (?, 'match', 'Zápas venku', '2026-08-01 10:00:00', 30, 'done')",
            [$this->season],
        );
        $eventId = $this->db->lastInsertId();
        $this->db->run(
            "INSERT INTO event_participant (event_id, membership_id, rsvp, transport, car_seats)
             VALUES (?, ?, 'yes', 'driver', 3)",
            [$eventId, $this->playerMembership],
        );

        $first = $this->service->syncTravelClaims($this->treasurer, $this->season);
        self::assertSame(1, $first['created']);
        self::assertSame(300, $first['items'][0]['amountCzk']);

        $this->db->run('UPDATE team_settings SET travel_rate_czk_km = 8, travel_round_trip = 0 WHERE team_id = ?', [$this->team]);
        $this->db->run('UPDATE event SET distance_km = 40 WHERE id = ?', [$eventId]);

        $second = $this->service->syncTravelClaims($this->treasurer, $this->season);
        self::assertSame(0, $second['created']);
        self::assertSame(1, $second['updated']);
        self::assertSame(5.0, $second['items'][0]['rateCzkKm']);
        self::assertSame(200, $second['items'][0]['amountCzk']);
        self::assertSame(1, (int) $this->db->value('SELECT COUNT(*) FROM travel_claim'));
    }

    public function testSyncDoesNotResurrectManuallyVoidedClaim(): void
    {
        $this->enableTravel();
        $this->makeAwayMatch(30);

        $created = $this->service->syncTravelClaims($this->treasurer, $this->season);
        self::assertSame(1, $created['created']);

        $this->service->voidTravelClaim($this->treasurer, (int) $created['items'][0]['id']);

        // Storno je rozhodnutí pínaře — další načtení ho nesmí obejít novým nárokem.
        $again = $this->service->syncTravelClaims($this->treasurer, $this->season);
        self::assertSame(0, $again['created']);
        self::assertSame(1, (int) $this->db->value('SELECT COUNT(*) FROM travel_claim'));
        self::assertSame(0, $this->balance($this->playerMembership));
    }

    public function testSyncSkipsHomeMatchWithStaleDistance(): void
    {
        $this->enableTravel();
        $eventId = $this->makeAwayMatch(30);

        // Vzdálenost zůstala ve sloupci z doby, kdy družstvo ještě nemělo domácí halu.
        $this->db->run('INSERT INTO location (club_id, name) VALUES (?, ?)', [$this->club, 'Hala Prosek']);
        $homeId = $this->db->lastInsertId();
        $this->db->run('UPDATE event SET location_id = ? WHERE id = ?', [$homeId, $eventId]);
        $this->db->run('UPDATE team_settings SET home_location_id = ? WHERE team_id = ?', [$homeId, $this->team]);

        $result = $this->service->syncTravelClaims($this->treasurer, $this->season);

        self::assertSame(0, $result['created']);
        self::assertSame([], $result['items']);
    }

    public function testSyncVoidsClaimWhenMatchBecomesHome(): void
    {
        $this->enableTravel();
        $eventId = $this->makeAwayMatch(30);
        self::assertSame(1, $this->service->syncTravelClaims($this->treasurer, $this->season)['created']);

        $this->db->run('INSERT INTO location (club_id, name) VALUES (?, ?)', [$this->club, 'Hala Prosek']);
        $homeId = $this->db->lastInsertId();
        $this->db->run('UPDATE event SET location_id = ? WHERE id = ?', [$homeId, $eventId]);
        $this->db->run('UPDATE team_settings SET home_location_id = ? WHERE team_id = ?', [$homeId, $this->team]);

        $result = $this->service->syncTravelClaims($this->treasurer, $this->season);

        self::assertSame(1, $result['voided']);
        self::assertSame(0, $this->balance($this->playerMembership));
    }

    public function testQrAmountMatchesShownBalanceEvenMimoObdobiSezony(): void
    {
        $this->setBankAccount('19-2000145399/0800');
        $this->makeRecord($this->season, $this->playerMembership, 250);
        // Datum zápisu mimo rozsah sezóny se stává: pínař zapíše turnaj před jejím začátkem.
        $this->db->run(
            'UPDATE offence_record SET occurred_on = \'2025-12-20\' WHERE membership_id = ?',
            [$this->playerMembership],
        );

        $qr = $this->service->paymentQr($this->player, $this->season, $this->playerMembership);

        self::assertSame($this->balance($this->playerMembership), $qr['amountCzk']);
        self::assertStringContainsString('AM:250.00', (string) $qr['spayd']);
    }

    public function testQrContainsCurrentDebtAccountAndReference(): void
    {
        $this->setBankAccount('19-2000145399/0800');
        $this->makeRecord($this->season, $this->playerMembership, 250);

        $qr = $this->service->paymentQr($this->player, $this->season, $this->playerMembership);

        self::assertSame(250, $qr['amountCzk']);
        self::assertStringContainsString('ACC:CZ6508000000192000145399', (string) $qr['spayd']);
        self::assertStringContainsString('AM:250.00', (string) $qr['spayd']);
        self::assertStringContainsString('X-VS:' . sprintf('%04d%04d', $this->team, $this->player->userId), (string) $qr['spayd']);
    }

    /**
     * Nálepka smí říkat, do kterého pololetí platba spadá, ale nikdy ne že se
     * platí jen ono — částka je vždycky celý neuhrazený zůstatek sezóny.
     */
    public function testQrNameNeverPromisesOnlyHalfOfTheSeason(): void
    {
        $this->setBankAccount('19-2000145399/0800');
        $this->db->run('UPDATE season SET half_year_on = \'2026-07-01\' WHERE id = ?', [$this->season]);

        $this->makeRecord($this->season, $this->playerMembership, 250);
        $this->db->run(
            'UPDATE offence_record SET occurred_on = \'2026-02-10\' WHERE membership_id = ?',
            [$this->playerMembership],
        );

        $qr = $this->service->paymentQr($this->player, $this->season, $this->playerMembership);

        self::assertSame('second', $qr['period']['half']);
        self::assertSame('Nedoplatek 2026', $qr['period']['name']);
        // Zápis je z 1. pololetí, dnešek z druhého — QR ho přesto musí obsahovat.
        self::assertSame(250, $qr['amountCzk']);
    }

    /** Účet je nastavení družstva, ne klubu — `ON DUPLICATE` kvůli `enableTravel`. */
    private function setBankAccount(string $account): void
    {
        $this->db->run(
            'INSERT INTO team_settings (team_id, bank_account) VALUES (?, ?)
             ON DUPLICATE KEY UPDATE bank_account = VALUES(bank_account)',
            [$this->team, $account],
        );
    }

    private function enableTravel(float $rate = 5.0, bool $roundTrip = true): void
    {
        $this->db->run(
            'INSERT INTO team_settings (team_id, travel_enabled, travel_rate_czk_km, travel_round_trip)
             VALUES (?, 1, ?, ?)',
            [$this->team, number_format($rate, 2, '.', ''), (int) $roundTrip],
        );
    }

    /** Proběhlý venkovní zápas s jedním řidičem. */
    private function makeAwayMatch(int $distanceKm): int
    {
        $this->db->run(
            "INSERT INTO event (season_id, type, title, starts_at, distance_km, status)
             VALUES (?, 'match', 'Zápas venku', '2026-08-01 10:00:00', ?, 'done')",
            [$this->season, $distanceKm],
        );
        $eventId = $this->db->lastInsertId();

        $this->db->run(
            "INSERT INTO event_participant (event_id, membership_id, rsvp, transport, car_seats)
             VALUES (?, ?, 'yes', 'driver', 3)",
            [$eventId, $this->playerMembership],
        );

        return $eventId;
    }

    private function balance(int $membershipId): int
    {
        $members = array_column(
            $this->offences->balances($this->treasurer, $this->season)['members'],
            null,
            'membershipId',
        );

        return $members[$membershipId]['balanceCzk'];
    }
}
