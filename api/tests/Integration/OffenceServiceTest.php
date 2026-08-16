<?php

declare(strict_types=1);

namespace Pina\Tests\Integration;

use Pina\Auth\Identity;
use Pina\Auth\Role;
use Pina\Auth\TeamScope;
use Pina\Http\ApiException;
use Pina\Service\OffenceService;

/**
 * Dávkový zápis prohřešků — jde o cizí peníze, takže se testuje důkladně:
 * idempotence, snapshot ceny, bonusy, storno a izolace klubů.
 */
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

        // count = 3 znamená tři samostatné řádky, ne jeden s násobkem.
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

    /** Hlavní nedostatek staré verze: změna sazebníku přepsala i historii. */
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

        // Bonusy mohou hráče dostat i do plusu — tým pak dluží jemu.
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

        // Nic se nemaže, jen se označí.
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

        // Honza 2×20 − 20 bonus = 20, Petr 20 → dávka celkem 40 Kč.
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

        // Hráči bez zápisu se v přehledu objeví s nulou.
        self::assertCount(4, $balances['members']);
        self::assertSame(20, $balances['totalCzk']);

        $byId = array_column($balances['members'], null, 'membershipId');
        self::assertSame(40, $byId[$this->honza]['balanceCzk']);
        self::assertSame(-20, $byId[$this->petr]['balanceCzk']);
    }

    /** Hráč bez zápisu musí mít nulu, ne jedničku z prázdného řádku po LEFT JOINu. */
    public function testBalancesCountZeroRecordsAsZero(): void
    {
        $this->batch([['membershipId' => $this->honza, 'offenceTypeId' => $this->lateType, 'count' => 2]]);

        $byId = array_column($this->service->balances($this->treasurer, $this->season)['members'], null, 'membershipId');

        self::assertSame(2, $byId[$this->honza]['recordCount']);
        self::assertSame(0, $byId[$this->petr]['recordCount']);
        self::assertSame(0, $byId[$this->petr]['balanceCzk']);
    }

    /** Stornovaný zápis se nepočítá ani do částky, ani do počtu. */
    public function testBalancesIgnoreVoidedRecords(): void
    {
        $batch = $this->batch([['membershipId' => $this->honza, 'offenceTypeId' => $this->lateType, 'count' => 1]]);
        $this->service->voidBatch($this->treasurer, (int) $batch['batch']['id']);

        $byId = array_column($this->service->balances($this->treasurer, $this->season)['members'], null, 'membershipId');

        self::assertSame(0, $byId[$this->honza]['recordCount']);
        self::assertSame(0, $byId[$this->honza]['balanceCzk']);
    }

    /**
     * Členství se kvůli historii nemaže, takže družstvo má víc členů než
     * kolik jich v dané sezóně hrálo. Přehled ukazuje soupisku sezóny.
     */
    public function testBalancesFollowSeasonRosterNotTeamMembership(): void
    {
        $this->makeMembership($this->makeUser('loni@prosek.cz'), $this->team, 'player');

        $balances = $this->service->balances($this->treasurer, $this->season);

        self::assertCount(4, $balances['members']);
        self::assertNotContains('loni', array_column($balances['members'], 'name'));
    }

    /** Odchod z týmu dluh nemaže — kdo má zápis, zůstává v přehledu i mimo soupisku. */
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
