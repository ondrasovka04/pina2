<?php

declare(strict_types=1);

namespace Pina\Tests\Integration;

use Pina\Auth\Identity;
use Pina\Auth\Role;
use Pina\Auth\TeamScope;
use Pina\Http\ApiException;
use Pina\Service\OffenceTypeService;

/** Oprávnění, archivace a přenesení sazebníku mezi sezónami. */
final class OffenceTypeServiceTest extends DatabaseTestCase
{
    private OffenceTypeService $service;

    private int $team;
    private int $season;
    private int $lastSeason;
    private Identity $admin;
    private Identity $treasurer;
    private Identity $player;

    protected function setUp(): void
    {
        parent::setUp();

        $this->service = new OffenceTypeService($this->db, new TeamScope($this->db));

        [, $this->team]   = $this->makeTeam('sk-prosek', 'Prosek - muži');
        $this->season     = $this->makeSeason($this->team, '26/27');
        $this->lastSeason = $this->makeSeason($this->team, '25/26');

        $this->admin     = $this->identity('admin@prosek.cz', Role::Admin);
        $this->treasurer = $this->identity('pinar@prosek.cz', Role::Treasurer);
        $this->player    = $this->identity('hrac@prosek.cz', Role::Player);
    }

    private function identity(string $email, Role $role): Identity
    {
        $userId = $this->makeUser($email);
        $this->makeMembership($userId, $this->team, $role->value);

        return new Identity($userId, $email, $email, false, [$this->team => $role]);
    }

    /** @param array<string,mixed> $overrides */
    private function create(array $overrides = [], ?int $seasonId = null): int
    {
        $input = [
            'name'          => 'Pozdní příchod',
            'amountCzk'     => 20,
            'sortOrder'     => 0,
            'category'      => 'discipline',
            'autoRule'      => 'none',
            'autoEventType' => 'any',
            ...$overrides,
        ];

        /**
         * @var array{
         *     name:string,amountCzk:int,sortOrder:int,category:string|null,
         *     autoRule:string,autoEventType:string
         * } $input
         */
        return $this->service->create($this->admin, $seasonId ?? $this->season, $input)['id'];
    }

    public function testListIsSortedBySortOrderAndHidesArchived(): void
    {
        $this->create(['name' => 'Pozdní příchod', 'sortOrder' => 20]);
        $this->create(['name' => 'Neomluvená absence', 'sortOrder' => 10]);
        $archived = $this->create(['name' => 'Zrušený prohřešek', 'sortOrder' => 5]);

        $this->service->archive($this->admin, $archived);

        $names = array_column($this->service->listForSeason($this->admin, $this->season), 'name');
        self::assertSame(['Neomluvená absence', 'Pozdní příchod'], $names);

        $withArchived = $this->service->listForSeason($this->admin, $this->season, includeArchived: true);
        self::assertCount(3, $withArchived);
    }

    /** Bonusy jsou v reálných datech běžné, záporná částka musí projít. */
    public function testNegativeAmountIsAllowed(): void
    {
        $id = $this->create(['name' => 'MVP extraligy', 'amountCzk' => -20, 'category' => 'performance']);

        $type = $this->service->listForSeason($this->admin, $this->season);
        self::assertSame(-20, $type[0]['amountCzk']);
        self::assertSame($id, $type[0]['id']);

        $updated = $this->service->update($this->admin, $id, ['amountCzk' => -200]);
        self::assertSame(-200, $updated['amountCzk']);
    }

    /** Sazebník spravuje pínař, ne admin. */
    public function testTreasurerManagesPriceList(): void
    {
        $created = $this->service->create($this->treasurer, $this->season, [
            'name'          => 'Vlastní sazba',
            'amountCzk'     => 50,
            'sortOrder'     => 0,
            'category'      => null,
            'autoRule'      => 'none',
            'autoEventType' => 'any',
        ]);

        self::assertSame(50, $this->service->update($this->treasurer, $created['id'], ['amountCzk' => 50])['amountCzk']);
        self::assertNotNull($this->service->archive($this->treasurer, $created['id'])['archivedAt']);
    }

    /** Pořadí sazebníku určuje, v jakém pořadí se položky nabízejí při zápisu. */
    public function testAutoRuleKnowsWhichKindOfEventItBelongsTo(): void
    {
        // Každé družstvo má jinou sazbu za trénink a za zápas, takže bez druhu
        // akce by návrh z docházky strhl částku o stovky vedle.
        $type = $this->service->create($this->treasurer, $this->season, [
            'name'          => 'Omluvený zápas',
            'amountCzk'     => 100,
            'sortOrder'     => 0,
            'category'      => 'attendance',
            'autoRule'      => 'excused_absence',
            'autoEventType' => 'match',
        ]);

        self::assertSame('excused_absence', $type['autoRule']);
        self::assertSame('match', $type['autoEventType']);

        $changed = $this->service->update($this->treasurer, $type['id'], ['autoEventType' => 'training']);
        self::assertSame('training', $changed['autoEventType']);
    }

    public function testReorderSetsDisplayOrder(): void
    {
        $late = $this->create(['name' => 'Pozdní příchod', 'sortOrder' => 10]);
        $card = $this->create(['name' => 'Žlutá karta', 'sortOrder' => 20]);
        $ball = $this->create(['name' => 'Nezamáčknutý balón', 'sortOrder' => 30]);

        $this->service->reorder($this->treasurer, $this->season, [$ball, $late, $card]);

        $names = array_column($this->service->listForSeason($this->treasurer, $this->season), 'name');
        self::assertSame(['Nezamáčknutý balón', 'Pozdní příchod', 'Žlutá karta'], $names);
    }

    public function testReorderRejectsForeignItem(): void
    {
        $mine  = $this->create();
        $other = $this->create(seasonId: $this->lastSeason);

        try {
            $this->service->reorder($this->treasurer, $this->season, [$mine, $other]);
            self::fail('cizí položka nesmí projít');
        } catch (ApiException $e) {
            self::assertSame(400, $e->status);
        }
    }

    public function testPlayerCannotReorderPriceList(): void
    {
        $id = $this->create();

        try {
            $this->service->reorder($this->player, $this->season, [$id]);
            self::fail('hráč nesmí měnit pořadí');
        } catch (ApiException $e) {
            self::assertSame(403, $e->status);
        }
    }

    public function testPlayerCannotEditPriceList(): void
    {
        try {
            $this->service->create($this->player, $this->season, [
                'name'      => 'Vlastní sazba',
                'amountCzk' => 50,
                'sortOrder' => 0,
                'category'  => null,
                'autoRule'  => 'none',
            'autoEventType' => 'any',
            ]);
            self::fail('hráč nesmí měnit sazebník');
        } catch (ApiException $e) {
            self::assertSame(403, $e->status);
        }
    }

    /** Archivace, ne mazání — kvůli historii. */
    public function testArchiveKeepsRow(): void
    {
        $id = $this->create();

        $archived = $this->service->archive($this->admin, $id);
        self::assertNotNull($archived['archivedAt']);

        self::assertSame(1, (int) $this->db->value('SELECT COUNT(*) FROM offence_type WHERE id = ?', [$id]));

        // Vrácení.
        $restored = $this->service->update($this->admin, $id, ['archived' => false]);
        self::assertNull($restored['archivedAt']);
    }

    public function testClosedSeasonRejectsChanges(): void
    {
        $closed = $this->makeSeason($this->team, '24/25', '2025-06-30 23:59:59');

        try {
            $this->create([], $closed);
            self::fail('do uzavřené sezóny se sazebník nepřidává');
        } catch (ApiException $e) {
            self::assertSame(409, $e->status);
            self::assertSame('SEASON_CLOSED', $e->errorCode);
        }
    }

    public function testCopyFromCopiesWholePriceList(): void
    {
        $this->create(['name' => 'Pozdní příchod', 'amountCzk' => 20, 'sortOrder' => 10], $this->lastSeason);
        $this->create(['name' => 'MVP', 'amountCzk' => -20, 'sortOrder' => 20], $this->lastSeason);
        $archived = $this->create(['name' => 'Stará položka'], $this->lastSeason);
        $this->service->archive($this->admin, $archived);

        $result = $this->service->copyFrom($this->admin, $this->season, $this->lastSeason);

        self::assertCount(2, $result['created']);
        self::assertSame([], $result['skipped']);
        self::assertSame([20, -20], array_column($result['created'], 'amountCzk'));

        // Už druhé spuštění nezaloží nic nového.
        $again = $this->service->copyFrom($this->admin, $this->season, $this->lastSeason);
        self::assertSame([], $again['created']);
        self::assertCount(2, $again['skipped']);
    }

    public function testCopyFromSelectedItemsWithNewPrices(): void
    {
        $late = $this->create(['name' => 'Pozdní příchod', 'amountCzk' => 20], $this->lastSeason);
        $this->create(['name' => 'Neomluvená absence', 'amountCzk' => 100], $this->lastSeason);

        $result = $this->service->copyFrom(
            $this->admin,
            $this->season,
            $this->lastSeason,
            [$late],
            [$late => 30],
        );

        self::assertCount(1, $result['created']);
        self::assertSame('Pozdní příchod', $result['created'][0]['name']);
        self::assertSame(30, $result['created'][0]['amountCzk']);

        // Zdroj beze změny.
        $source = array_column($this->service->listForSeason($this->admin, $this->lastSeason), 'amountCzk', 'name');
        self::assertSame(20, $source['Pozdní příchod']);
    }

    public function testCopyFromForeignTeamIsNotFound(): void
    {
        [, $otherTeam] = $this->makeTeam('vk-benatky', 'VK Benátky');
        $otherSeason   = $this->makeSeason($otherTeam, '25/26');

        try {
            $this->service->copyFrom($this->admin, $this->season, $otherSeason);
            self::fail('sazebník cizího klubu nesmí být dostupný');
        } catch (ApiException $e) {
            self::assertSame(404, $e->status);
        }
    }

    public function testForeignSeasonIsNotFound(): void
    {
        [, $otherTeam] = $this->makeTeam('vk-benatky', 'VK Benátky');
        $otherSeason   = $this->makeSeason($otherTeam, '26/27');

        try {
            $this->service->listForSeason($this->admin, $otherSeason);
            self::fail('cizí sezóna se má tvářit jako neexistující');
        } catch (ApiException $e) {
            self::assertSame(404, $e->status);
        }
    }

    public function testUpdateWithoutChangesFails(): void
    {
        $id = $this->create();

        try {
            $this->service->update($this->admin, $id, []);
            self::fail('prázdná úprava nemá smysl');
        } catch (ApiException $e) {
            self::assertSame(400, $e->status);
        }
    }
}
