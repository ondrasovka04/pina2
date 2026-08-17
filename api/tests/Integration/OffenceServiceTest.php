<?php

declare(strict_types=1);

namespace Pina\Tests\Integration;

use Pina\Auth\Identity;
use Pina\Auth\Role;
use Pina\Auth\TeamScope;
use Pina\Http\ApiException;
use Pina\Service\OffenceService;

/** Důkladné testování dávek: idempotence, cena, bonusy, storno, izolace. */
final class OffenceServiceTest extends DatabaseTestCase
{
    private OffenceService $service;

    private int $team;
    private int $season;
    private int $honza;
    private int $petr;
    private int $lateType;   // Pozdní příchod, 20 Kč
    private int $mvpType;    // MVP extraligy, −20 Kč (bonus)

    private Identity $treasurer;
    private Identity $player;
    private int $playerMembership;

    protected function setUp(): void
    {
        parent::setUp();

        $this->service = new OffenceService($this->db, new TeamScope($this->db));

        [, $this->team] = $this->makeTeam('sk-prosek', 'Prosek - muži');
        $this->season   = $this->makeSeason($this->team, '26/27');

        $this->honza = $this->makeMembership($this->makeUser('honza@prosek.cz'), $this->team, 'player');
        $this->petr  = $this->makeMembership($this->makeUser('petr@prosek.cz'), $this->team, 'player');

        $this->lateType = $this->makeOffenceType($this->season, 'Pozdní příchod', 20, 10);
        $this->mvpType  = $this->makeOffenceType($this->season, 'MVP extraligy', -20, 20);

        $pinarId         = $this->makeUser('pinar@prosek.cz');
        $pinar           = $this->makeMembership($pinarId, $this->team, 'treasurer');
        $this->treasurer = new Identity($pinarId, 'pinar@prosek.cz', 'Pínař', false, [
            $this->team => Role::Treasurer,
        ]);

        $hracId       = $this->makeUser('hrac@prosek.cz');
        $hrac         = $this->makeMembership($hracId, $this->team, 'player');
        $this->playerMembership = $hrac;
        $this->player = new Identity($hracId, 'hrac@prosek.cz', 'Hráč', false, [
            $this->team => Role::Player,
        ]);

        $this->makeRoster($this->season, [$this->honza, $this->petr, $pinar, $hrac]);
    }

    private function makeOffenceType(int $seasonId, string $name, int $amount, int $sortOrder = 0): int
    {
        $this->db->run(
            'INSERT INTO offence_type (season_id, name, amount_czk, sort_order) VALUES (?, ?, ?, ?)',
            [$seasonId, $name, $amount, $sortOrder],
        );

        return $this->db->lastInsertId();
    }

    /**
     * @param  list<array{membershipId:int,offenceTypeId:int,count:int,note?:string|null,expectedAmountCzk?:int|null}> $items
     * @return array<string,mixed>
     */
    private function batch(array $items, string $uuid = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee', ?Identity $as = null, ?int $seasonId = null): array
    {
        $normalized = array_map(
            static fn (array $item): array => [
                'membershipId'      => $item['membershipId'],
                'offenceTypeId'     => $item['offenceTypeId'],
                'count'             => $item['count'],
                'note'              => $item['note'] ?? null,
                'expectedAmountCzk' => $item['expectedAmountCzk'] ?? null,
            ],
            $items,
        );

        return $this->service->createBatch($as ?? $this->treasurer, $seasonId ?? $this->season, [
            'clientUuid' => $uuid,
            'occurredOn' => '2026-09-16',
            'eventId'    => null,
            'title'      => 'Trénink 16. 9.',
            'note'       => null,
            'items'      => $normalized,
        ]);
    }

    public function testBatchCreatesRecordsAndSum(): void
    {
        $summary = $this->batch([
            ['membershipId' => $this->honza, 'offenceTypeId' => $this->lateType, 'count' => 3],
            ['membershipId' => $this->petr, 'offenceTypeId' => $this->lateType, 'count' => 1],
        ]);

        // count = 3 → tři samostatné řádky, ne jeden s násobkem.
        self::assertSame(4, (int) $this->db->value('SELECT COUNT(*) FROM offence_record'));
        self::assertSame(4, $summary['recordCount']);
        self::assertSame(80, $summary['totalCzk']);
        self::assertSame(2, $summary['memberCount']);

        $honza = $this->memberOf($summary, $this->honza);
        self::assertSame(60, $honza['totalCzk']);
        self::assertSame(60, $honza['balanceCzk']);
        self::assertSame(3, $honza['items'][0]['count']);
        self::assertSame('Pozdní příchod', $honza['items'][0]['name']);
    }

    /** Dvojklik ani výpadek sítě nesmí zapsat peníze dvakrát. */
    public function testSameClientUuidWritesOnlyOnce(): void
    {
        $items = [['membershipId' => $this->honza, 'offenceTypeId' => $this->lateType, 'count' => 2]];

        $first  = $this->batch($items);
        $second = $this->batch($items);

        self::assertSame($first['batch']['id'], $second['batch']['id']);
        self::assertSame(1, (int) $this->db->value('SELECT COUNT(*) FROM offence_batch'));
        self::assertSame(2, (int) $this->db->value('SELECT COUNT(*) FROM offence_record'));
        self::assertSame(40, $second['totalCzk']);
    }

    /** Změna sazebníku nesmí přepsat starší zápisy. */
    public function testPriceChangeDoesNotRewriteHistory(): void
    {
        $this->batch([['membershipId' => $this->honza, 'offenceTypeId' => $this->lateType, 'count' => 1]]);

        $this->db->run('UPDATE offence_type SET amount_czk = 50 WHERE id = ?', [$this->lateType]);

        self::assertSame(20, $this->balanceOf($this->honza));

        $records = $this->service->listRecords($this->treasurer, $this->season, $this->honza);
        self::assertSame(20, $records['items'][0]['amountCzk']);

        // Nový zápis už jede za novou cenu.
        $this->batch(
            [['membershipId' => $this->honza, 'offenceTypeId' => $this->lateType, 'count' => 1]],
            '11111111-1111-1111-1111-111111111111',
        );

        self::assertSame(70, $this->balanceOf($this->honza));
    }

    /** Bonus je záporná částka a dluh snižuje. */
    public function testNegativeAmountLowersDebt(): void
    {
        $this->batch([
            ['membershipId' => $this->honza, 'offenceTypeId' => $this->lateType, 'count' => 3],
            ['membershipId' => $this->honza, 'offenceTypeId' => $this->mvpType, 'count' => 1],
        ]);

        self::assertSame(40, $this->balanceOf($this->honza));

        // Bonusy mohou dát hráči plus — tým pak dluží jemu.
        $this->batch(
            [['membershipId' => $this->petr, 'offenceTypeId' => $this->mvpType, 'count' => 2]],
            '22222222-2222-2222-2222-222222222222',
        );

        self::assertSame(-40, $this->balanceOf($this->petr));
    }

    public function testVoidingBatchRemovesWholeAmountFromDebt(): void
    {
        $summary = $this->batch([
            ['membershipId' => $this->honza, 'offenceTypeId' => $this->lateType, 'count' => 2],
            ['membershipId' => $this->petr, 'offenceTypeId' => $this->lateType, 'count' => 1],
        ]);

        $batchId = $summary['batch']['id'];
        self::assertIsInt($batchId);

        $voided = $this->service->voidBatch($this->treasurer, $batchId);

        self::assertNotNull($voided['batch']['voidedAt']);
        self::assertSame(0, $voided['totalCzk']);
        self::assertSame(3, $voided['voidedRecordCount']);
        self::assertSame(0, $this->balanceOf($this->honza));
        self::assertSame(0, $this->balanceOf($this->petr));

        // Označení místo mazání.
        self::assertSame(3, (int) $this->db->value('SELECT COUNT(*) FROM offence_record'));
        self::assertSame(
            3,
            (int) $this->db->value('SELECT COUNT(*) FROM offence_record WHERE voided_at IS NOT NULL'),
        );

        // Opakované storno nic nerozbije.
        $again = $this->service->voidBatch($this->treasurer, $batchId);
        self::assertSame($voided['batch']['voidedAt'], $again['batch']['voidedAt']);
    }

    public function testVoidingSingleRecordRemovesOnlyItsAmount(): void
    {
        $this->batch([['membershipId' => $this->honza, 'offenceTypeId' => $this->lateType, 'count' => 3]]);

        $recordId = (int) $this->db->value('SELECT MIN(id) FROM offence_record');
        $result   = $this->service->voidRecord($this->treasurer, $recordId);

        self::assertNotNull($result['record']['voidedAt']);
        self::assertSame(40, $result['balanceCzk']);
        self::assertSame(40, $this->balanceOf($this->honza));
    }

    public function testPlayerCannotWriteOffences(): void
    {
        try {
            $this->batch(
                [['membershipId' => $this->honza, 'offenceTypeId' => $this->lateType, 'count' => 1]],
                '33333333-3333-3333-3333-333333333333',
                $this->player,
            );
            self::fail('hráč nesmí zapisovat prohřešky');
        } catch (ApiException $e) {
            self::assertSame(403, $e->status);
        }

        self::assertSame(0, (int) $this->db->value('SELECT COUNT(*) FROM offence_record'));
    }

    public function testClosedSeasonRejectsBatch(): void
    {
        $closed = $this->makeSeason($this->team, '25/26', '2026-06-30 23:59:59');
        $type   = $this->makeOffenceType($closed, 'Pozdní příchod', 20);

        try {
            $this->batch(
                [['membershipId' => $this->honza, 'offenceTypeId' => $type, 'count' => 1]],
                '44444444-4444-4444-4444-444444444444',
                seasonId: $closed,
            );
            self::fail('do uzavřené sezóny se nezapisuje');
        } catch (ApiException $e) {
            self::assertSame(409, $e->status);
            self::assertSame('SEASON_CLOSED', $e->errorCode);
        }
    }

    public function testForeignSeasonIsNotFound(): void
    {
        [, $otherTeam] = $this->makeTeam('vk-benatky', 'VK Benátky');
        $otherSeason   = $this->makeSeason($otherTeam, '26/27');
        $otherType     = $this->makeOffenceType($otherSeason, 'Pozdní příchod', 20);

        try {
            $this->batch(
                [['membershipId' => $this->honza, 'offenceTypeId' => $otherType, 'count' => 1]],
                '55555555-5555-5555-5555-555555555555',
                seasonId: $otherSeason,
            );
            self::fail('cizí sezóna se má tvářit jako neexistující');
        } catch (ApiException $e) {
            self::assertSame(404, $e->status);
        }
    }

    public function testMembershipFromForeignTeamIsRejected(): void
    {
        [, $otherTeam] = $this->makeTeam('vk-benatky', 'VK Benátky');
        $foreign       = $this->makeMembership($this->makeUser('cizi@benatky.cz'), $otherTeam, 'player');

        try {
            $this->batch([
                ['membershipId' => $this->honza, 'offenceTypeId' => $this->lateType, 'count' => 1],
                ['membershipId' => $foreign, 'offenceTypeId' => $this->lateType, 'count' => 1],
            ]);
            self::fail('hráči cizího klubu nelze nic zapsat');
        } catch (ApiException $e) {
            self::assertSame(400, $e->status);
            self::assertSame([$foreign], $e->details['membershipIds']);
        }

        // Transakce: neprošlo nic, ani ta platná položka.
        self::assertSame(0, (int) $this->db->value('SELECT COUNT(*) FROM offence_record'));
        self::assertSame(0, (int) $this->db->value('SELECT COUNT(*) FROM offence_batch'));
    }

    public function testOffenceTypeFromAnotherSeasonIsRejected(): void
    {
        $otherSeason = $this->makeSeason($this->team, '25/26');
        $otherType   = $this->makeOffenceType($otherSeason, 'Pozdní příchod', 20);

        try {
            $this->batch([['membershipId' => $this->honza, 'offenceTypeId' => $otherType, 'count' => 1]]);
            self::fail('prohřešek z jiné sezóny do dávky nepatří');
        } catch (ApiException $e) {
            self::assertSame(400, $e->status);
        }
    }

    /** Pokud se sazebník změnil mezi souhrnem a odesláním, klient dostane 409. */
    public function testChangedPriceIsReportedAsConflict(): void
    {
        try {
            $this->batch([[
                'membershipId'      => $this->honza,
                'offenceTypeId'     => $this->lateType,
                'count'             => 1,
                'expectedAmountCzk' => 15,
            ]]);
            self::fail('rozdílná cena musí skončit konfliktem');
        } catch (ApiException $e) {
            self::assertSame(409, $e->status);
            self::assertSame('PRICE_CHANGED', $e->errorCode);
        }

        self::assertSame(0, (int) $this->db->value('SELECT COUNT(*) FROM offence_record'));
    }

    public function testBatchDetailShowsBreakdownPerMember(): void
    {
        $created = $this->batch([
            ['membershipId' => $this->honza, 'offenceTypeId' => $this->lateType, 'count' => 2],
            ['membershipId' => $this->honza, 'offenceTypeId' => $this->mvpType, 'count' => 1],
            ['membershipId' => $this->petr, 'offenceTypeId' => $this->lateType, 'count' => 1],
        ]);

        $batchId = $created['batch']['id'];
        self::assertIsInt($batchId);

        $detail = $this->service->showBatch($this->player, $batchId);

        // Honza: 2×20−20=20 Kč, Petr: 20 Kč, dávka: 40 Kč.
        self::assertSame(40, $detail['totalCzk']);
        self::assertSame('Trénink 16. 9.', $detail['batch']['title']);

        $honza = $this->memberOf($detail, $this->honza);
        self::assertCount(2, $honza['items']);
        self::assertSame(20, $honza['totalCzk']);
        self::assertSame(20, $honza['balanceCzk']);
    }

    public function testBalancesIncludeEveryoneAndSignedSum(): void
    {
        $this->batch([
            ['membershipId' => $this->honza, 'offenceTypeId' => $this->lateType, 'count' => 2],
            ['membershipId' => $this->petr, 'offenceTypeId' => $this->mvpType, 'count' => 1],
        ]);

        $balances = $this->service->balances($this->treasurer, $this->season);

        // Všichni členové soupisky, i bez zápisu (nula).
        self::assertCount(4, $balances['members']);
        self::assertSame(20, $balances['totalCzk']);

        $byId = array_column($balances['members'], null, 'membershipId');
        self::assertSame(40, $byId[$this->honza]['balanceCzk']);
        self::assertSame(-20, $byId[$this->petr]['balanceCzk']);
    }

    public function testBalancesSplitMoneyByHalfYearBoundary(): void
    {
        $this->db->run('UPDATE season SET half_year_on = \'2027-01-01\' WHERE id = ?', [$this->season]);

        // Podzim: prohřešek 200 a bonus -50. Jaro: prohřešek 40 a platba 100.
        $this->recordOn($this->honza, 200, '2026-10-05');
        $this->recordOn($this->honza, -50, '2026-11-20');
        $this->recordOn($this->honza, 40, '2027-03-08');
        $this->db->run(
            "INSERT INTO payment (season_id, membership_id, amount_czk, paid_on, method)
             VALUES (?, ?, 100, '2027-02-01', 'cash')",
            [$this->season, $this->honza],
        );

        $balances = $this->service->balances($this->treasurer, $this->season);
        $member   = $this->memberRow($balances['members'], $this->honza);
        $halves   = $member['halves'];
        self::assertNotNull($halves);

        self::assertSame('2027-01-01', $balances['halfYearOn']);
        self::assertSame(200, $halves['first']['offencesCzk']);
        self::assertSame(-50, $halves['first']['bonusesCzk']);
        self::assertSame(0, $halves['first']['paidCzk']);
        self::assertSame(150, $halves['first']['balanceCzk']);

        self::assertSame(40, $halves['second']['offencesCzk']);
        self::assertSame(100, $halves['second']['paidCzk']);
        self::assertSame(-60, $halves['second']['balanceCzk']);

        // Ploché hodnoty musí být součet obou polovin, jinak by si obrazovky odporovaly.
        self::assertSame(90, $member['balanceCzk']);
        self::assertSame(240, $member['offencesCzk']);
        self::assertSame(3, $member['recordCount']);
    }

    public function testBalancesWithoutBoundaryHaveNoHalves(): void
    {
        $this->db->run('UPDATE season SET half_year_on = NULL WHERE id = ?', [$this->season]);
        $this->recordOn($this->honza, 200, '2026-10-05');

        $balances = $this->service->balances($this->treasurer, $this->season);

        self::assertNull($balances['halfYearOn']);
        self::assertNull($balances['halves']);
        self::assertSame(['all'], array_column($balances['periods'], 'key'));
        self::assertNull($this->memberRow($balances['members'], $this->honza)['halves']);
        self::assertSame(200, $this->memberRow($balances['members'], $this->honza)['balanceCzk']);
    }

    public function testPeriodBoundsFollowTheConfiguredBoundary(): void
    {
        $this->db->run('UPDATE season SET half_year_on = \'2027-01-01\' WHERE id = ?', [$this->season]);

        $periods = $this->service->balances($this->treasurer, $this->season)['periods'];
        $byKey   = array_column($periods, null, 'key');

        self::assertSame(['all', 'first', 'second'], array_keys($byKey));
        self::assertSame('2026-12-31', $byKey['first']['to']);
        self::assertSame('2027-01-01', $byKey['second']['from']);
        self::assertSame('2027-06-30', $byKey['second']['to']);
    }

    public function testHiddenBalancesReturnOnlyPlayersOwnRow(): void
    {
        $this->db->run(
            'INSERT INTO team_settings (team_id, balances_visible_to_players) VALUES (?, 0)',
            [$this->team],
        );
        $this->batch([['membershipId' => $this->honza, 'offenceTypeId' => $this->lateType, 'count' => 1]]);

        $balances = $this->service->balances($this->player, $this->season);

        self::assertCount(1, $balances['members']);
        self::assertSame($this->playerMembership, $balances['members'][0]['membershipId']);
        self::assertCount(4, $this->service->balances($this->treasurer, $this->season)['members']);
    }

    public function testHiddenBalancesAlsoProtectForeignRecordDetail(): void
    {
        $this->db->run(
            'INSERT INTO team_settings (team_id, balances_visible_to_players) VALUES (?, 0)',
            [$this->team],
        );
        $this->batch([['membershipId' => $this->honza, 'offenceTypeId' => $this->lateType, 'count' => 1]]);

        try {
            $this->service->listRecords($this->player, $this->season, $this->honza);
            self::fail('Hráč nesmí načíst cizí položky přímým ID.');
        } catch (ApiException $e) {
            self::assertSame(404, $e->status);
        }
    }

    public function testHiddenBalancesAlsoLimitBatchHistory(): void
    {
        $this->db->run(
            'INSERT INTO team_settings (team_id, balances_visible_to_players) VALUES (?, 0)',
            [$this->team],
        );
        $foreign = $this->batch([['membershipId' => $this->honza, 'offenceTypeId' => $this->lateType, 'count' => 1]]);
        $own = $this->batch(
            [['membershipId' => $this->playerMembership, 'offenceTypeId' => $this->lateType, 'count' => 2]],
            '99999999-9999-9999-9999-999999999999',
        );

        $batches = $this->service->batches($this->player, $this->season);
        self::assertCount(1, $batches);
        self::assertSame($own['batch']['id'], $batches[0]['id']);
        self::assertSame(40, $batches[0]['totalCzk']);

        try {
            $this->service->showBatch($this->player, (int) $foreign['batch']['id']);
            self::fail('Cizí dávka bez vlastního zápisu má zůstat skrytá.');
        } catch (ApiException $e) {
            self::assertSame(404, $e->status);
        }
    }

    /** Bez zápisu se počítá 0 záznamů, ne 1 z LEFT JOINu. */
    public function testBalancesCountZeroRecordsAsZero(): void
    {
        $this->batch([['membershipId' => $this->honza, 'offenceTypeId' => $this->lateType, 'count' => 2]]);

        $byId = array_column($this->service->balances($this->treasurer, $this->season)['members'], null, 'membershipId');

        self::assertSame(2, $byId[$this->honza]['recordCount']);
        self::assertSame(0, $byId[$this->petr]['recordCount']);
        self::assertSame(0, $byId[$this->petr]['balanceCzk']);
    }

    /** Stornované záp isy se nepočítají. */
    public function testBalancesIgnoreVoidedRecords(): void
    {
        $batch = $this->batch([['membershipId' => $this->honza, 'offenceTypeId' => $this->lateType, 'count' => 1]]);
        $this->service->voidBatch($this->treasurer, (int) $batch['batch']['id']);

        $byId = array_column($this->service->balances($this->treasurer, $this->season)['members'], null, 'membershipId');

        self::assertSame(0, $byId[$this->honza]['recordCount']);
        self::assertSame(0, $byId[$this->honza]['balanceCzk']);
    }

    /** Přehled ukazuje soupisu sezóny, ne všechna členství. */
    public function testBalancesFollowSeasonRosterNotTeamMembership(): void
    {
        $this->makeMembership($this->makeUser('loni@prosek.cz'), $this->team, 'player');

        $balances = $this->service->balances($this->treasurer, $this->season);

        self::assertCount(4, $balances['members']);
        self::assertNotContains('loni', array_column($balances['members'], 'name'));
    }

    /** Člen s dluhem zůstane i bez soupisy. */
    public function testBalancesKeepMemberWithRecordsOutsideRoster(): void
    {
        $odchozi = $this->makeMembership($this->makeUser('odchozi@prosek.cz'), $this->team, 'player', 'left');
        $this->batch([['membershipId' => $odchozi, 'offenceTypeId' => $this->lateType, 'count' => 3]]);

        $byId = array_column($this->service->balances($this->treasurer, $this->season)['members'], null, 'membershipId');

        self::assertSame(60, $byId[$odchozi]['balanceCzk']);
        self::assertFalse($byId[$odchozi]['onRoster']);
        self::assertTrue($byId[$this->honza]['onRoster']);
    }

    public function testListRecordsFiltersByMemberAndDate(): void
    {
        $this->batch([['membershipId' => $this->honza, 'offenceTypeId' => $this->lateType, 'count' => 1]]);

        $this->service->createBatch($this->treasurer, $this->season, [
            'clientUuid' => '66666666-6666-6666-6666-666666666666',
            'occurredOn' => '2026-10-01',
            'eventId'    => null,
            'title'      => null,
            'note'       => null,
            'items'      => [[
                'membershipId'      => $this->petr,
                'offenceTypeId'     => $this->lateType,
                'count'             => 2,
                'note'              => null,
                'expectedAmountCzk' => null,
            ]],
        ]);

        self::assertSame(3, $this->service->listRecords($this->treasurer, $this->season)['count']);
        self::assertSame(1, $this->service->listRecords($this->treasurer, $this->season, $this->honza)['count']);
        self::assertSame(
            2,
            $this->service->listRecords($this->treasurer, $this->season, null, '2026-09-20')['count'],
        );
        self::assertSame(
            1,
            $this->service->listRecords($this->treasurer, $this->season, null, null, '2026-09-30')['count'],
        );
    }

    public function testVoidedRecordsAreHiddenUnlessRequested(): void
    {
        $this->batch([['membershipId' => $this->honza, 'offenceTypeId' => $this->lateType, 'count' => 2]]);

        $recordId = (int) $this->db->value('SELECT MIN(id) FROM offence_record');
        $this->service->voidRecord($this->treasurer, $recordId);

        self::assertSame(1, $this->service->listRecords($this->treasurer, $this->season)['count']);
        self::assertSame(
            2,
            $this->service->listRecords($this->treasurer, $this->season, null, null, null, includeVoided: true)['count'],
        );
    }

    public function testBatchListGivesPinarWhatHeNeedsToVoidAWholeTraining(): void
    {
        $this->batch([
            ['membershipId' => $this->honza, 'offenceTypeId' => $this->lateType, 'count' => 2],
            ['membershipId' => $this->petr, 'offenceTypeId' => $this->lateType, 'count' => 1],
        ]);

        $items = $this->service->batches($this->treasurer, $this->season);

        self::assertCount(1, $items);
        self::assertSame('Trénink 16. 9.', $items[0]['title']);
        self::assertSame(3, $items[0]['recordCount']);
        self::assertSame(2, $items[0]['memberCount']);
        self::assertSame(60, $items[0]['totalCzk']);
        // Jméno se bere z databáze, ne z tokenu — pínař se mohl mezitím přejmenovat.
        self::assertSame('pinar', $items[0]['createdBy']['name'] ?? null);
        self::assertNull($items[0]['voidedAt']);
    }

    public function testVoidedBatchIsListedButCountsNothing(): void
    {
        $summary = $this->batch([
            ['membershipId' => $this->honza, 'offenceTypeId' => $this->lateType, 'count' => 2],
        ]);

        $this->service->voidBatch($this->treasurer, $summary['batch']['id']);

        $items = $this->service->batches($this->treasurer, $this->season);

        self::assertNotNull($items[0]['voidedAt']);
        self::assertSame(0, $items[0]['recordCount']);
        self::assertSame(0, $items[0]['totalCzk']);
    }

    public function testBatchListIsNewestFirst(): void
    {
        $this->batch(
            [['membershipId' => $this->honza, 'offenceTypeId' => $this->lateType, 'count' => 1]],
            'aaaaaaaa-1111-cccc-dddd-eeeeeeeeeeee',
        );

        $second = $this->service->createBatch($this->treasurer, $this->season, [
            'clientUuid' => 'aaaaaaaa-2222-cccc-dddd-eeeeeeeeeeee',
            'occurredOn' => '2026-09-23',
            'eventId'    => null,
            'title'      => 'Trénink 23. 9.',
            'note'       => null,
            'items'      => [
                [
                    'membershipId'      => $this->petr,
                    'offenceTypeId'     => $this->lateType,
                    'count'             => 1,
                    'note'              => null,
                    'expectedAmountCzk' => null,
                ],
            ],
        ]);

        $items = $this->service->batches($this->treasurer, $this->season);

        // Pínař hledá poslední trénink, ne ten zářijový úplně první.
        self::assertSame($second['batch']['id'], $items[0]['id']);
    }

    public function testForeignBatchIsNotFound(): void
    {
        $summary = $this->batch([['membershipId' => $this->honza, 'offenceTypeId' => $this->lateType, 'count' => 1]]);
        $batchId = $summary['batch']['id'];
        self::assertIsInt($batchId);

        [, $otherTeam] = $this->makeTeam('vk-benatky', 'VK Benátky');
        $outsiderId    = $this->makeUser('pinar@benatky.cz');
        $this->makeMembership($outsiderId, $otherTeam, 'treasurer');
        $outsider = new Identity($outsiderId, 'pinar@benatky.cz', 'Cizí pínař', false, [
            $otherTeam => Role::Treasurer,
        ]);

        try {
            $this->service->showBatch($outsider, $batchId);
            self::fail('cizí dávka nesmí být dostupná');
        } catch (ApiException $e) {
            self::assertSame(404, $e->status);
        }
    }

    private function balanceOf(int $membershipId): int
    {
        $balances = $this->service->balances($this->treasurer, $this->season);

        foreach ($balances['members'] as $member) {
            if ($member['membershipId'] === $membershipId) {
                return $member['balanceCzk'];
            }
        }

        self::fail('hráč není v přehledu dluhů');
    }

    /** Zápis s konkrétním datem — pro dělení na pololetí je datum to jediné, co rozhoduje. */
    private function recordOn(int $membershipId, int $amountCzk, string $occurredOn): void
    {
        $this->db->run(
            'INSERT INTO offence_record (season_id, membership_id, offence_type_id, amount_czk, occurred_on)
             VALUES (?, ?, ?, ?, ?)',
            [$this->season, $membershipId, $this->lateType, $amountCzk, $occurredOn],
        );
    }

    /**
     * @param  list<array{membershipId:int,userId:int,name:string,jerseyNumber:int|null,status:string,
     *     onRoster:bool,recordCount:int,offencesCzk:int,bonusesCzk:int,paidCzk:int,travelCzk:int,
     *     balanceCzk:int,halves:array{first:array<string,int>,second:array<string,int>}|null}> $members
     * @return array{membershipId:int,userId:int,name:string,jerseyNumber:int|null,status:string,
     *     onRoster:bool,recordCount:int,offencesCzk:int,bonusesCzk:int,paidCzk:int,travelCzk:int,
     *     balanceCzk:int,halves:array{first:array<string,int>,second:array<string,int>}|null}
     */
    private function memberRow(array $members, int $membershipId): array
    {
        foreach ($members as $member) {
            if ($member['membershipId'] === $membershipId) {
                return $member;
            }
        }

        self::fail('hráč není v přehledu dluhů');
    }

    /**
     * @param  array<string,mixed> $summary
     * @return array<string,mixed>
     */
    private function memberOf(array $summary, int $membershipId): array
    {
        self::assertIsArray($summary['members']);

        foreach ($summary['members'] as $member) {
            self::assertIsArray($member);

            if ($member['membershipId'] === $membershipId) {
                return $member;
            }
        }

        self::fail('hráč není v rozpisu dávky');
    }
}
