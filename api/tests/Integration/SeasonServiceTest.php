<?php

declare(strict_types=1);

namespace Pina\Tests\Integration;

use Pina\Auth\Identity;
use Pina\Auth\Role;
use Pina\Auth\TeamScope;
use Pina\Http\ApiException;
use Pina\Service\SeasonService;

/** Izolace, uzamčení, jedinečnost aktuální sezóny. */
final class SeasonServiceTest extends DatabaseTestCase
{
    private SeasonService $service;

    private int $prosekTeam;
    private int $benatkyTeam;

    private Identity $admin;
    private Identity $player;
    private int $playerMembership;

    protected function setUp(): void
    {
        parent::setUp();

        $this->service = new SeasonService($this->db, new TeamScope($this->db));

        [, $this->prosekTeam]  = $this->makeTeam('sk-prosek', 'Prosek - muži');
        [, $this->benatkyTeam] = $this->makeTeam('vk-benatky', 'VK Benátky');

        $adminId = $this->makeUser('admin@prosek.cz');
        $this->makeMembership($adminId, $this->prosekTeam, 'admin');
        $this->admin = $this->identity($adminId, 'admin@prosek.cz', $this->prosekTeam, Role::Admin);

        $playerId               = $this->makeUser('hrac@prosek.cz');
        $this->playerMembership = $this->makeMembership($playerId, $this->prosekTeam, 'player');
        $this->player           = $this->identity($playerId, 'hrac@prosek.cz', $this->prosekTeam, Role::Player);
    }

    public function testNewSeasonBecomesTheOnlyCurrentOne(): void
    {
        $first = $this->service->create($this->admin, $this->prosekTeam, '25/26', '2025-09-01', '2026-06-30');
        self::assertTrue($first['isCurrent']);

        $second = $this->service->create($this->admin, $this->prosekTeam, '26/27', '2026-09-01', '2027-06-30');
        self::assertTrue($second['isCurrent']);

        self::assertSame(
            1,
            (int) $this->db->value(
                'SELECT COUNT(*) FROM season WHERE team_id = ? AND is_current = 1',
                [$this->prosekTeam],
            ),
        );
        self::assertSame(
            0,
            (int) $this->db->value('SELECT is_current FROM season WHERE id = ?', [$first['id']]),
        );
    }

    public function testPlayerSeesOnlySeasonsHeIsRosteredIn(): void
    {
        // Jen sezóny v soupisce, ne všechny družstva.
        $this->makeSeason($this->prosekTeam, '24/25');
        $last    = $this->makeSeason($this->prosekTeam, '25/26');
        $current = $this->makeSeason($this->prosekTeam, '26/27');
        $this->db->run('UPDATE season SET is_current = 1 WHERE id = ?', [$current]);
        $this->makeRoster($last, [$this->playerMembership]);

        $names = array_column($this->service->forTeam($this->player, $this->prosekTeam), 'name');

        // Jen 25/26. Ani probíhající sezóna výjimku nemá — rozhoduje soupiska,
        // ne členství v družstvu.
        self::assertSame(['25/26'], $names);

        // Admin spravuje historii družstva, ten vidí všechno.
        self::assertCount(3, $this->service->forTeam($this->admin, $this->prosekTeam));
    }

    public function testPlatformAdminIsStillJustAPlayerInHisOwnTeam(): void
    {
        // Admin platformy je v cizím týmu jen hráčem — příznak neotevírá historii.
        $this->makeSeason($this->prosekTeam, '24/25');
        $mine = $this->makeSeason($this->prosekTeam, '25/26');
        $this->makeRoster($mine, [$this->playerMembership]);

        $superadmin = new Identity(
            $this->player->userId,
            'hrac@prosek.cz',
            'hrac@prosek.cz',
            isPlatformAdmin: true,
            rolesByTeam: [$this->prosekTeam => Role::Player],
        );

        self::assertSame(['25/26'], array_column($this->service->forTeam($superadmin, $this->prosekTeam), 'name'));
    }

    public function testMemberOnNoRosterSeesNoSeasonsAtAll(): void
    {
        // Nový člen bez soupisu → žádné sezóny.
        $current = $this->makeSeason($this->prosekTeam, '26/27');
        $this->db->run('UPDATE season SET is_current = 1 WHERE id = ?', [$current]);

        self::assertSame([], $this->service->forTeam($this->player, $this->prosekTeam));
    }

    public function testPlayerSeesSeasonWhereHeHasRecordsEvenWithoutRoster(): void
    {
        // Člen mimo soupisku vidí sezónu, kde má dluh.
        $past = $this->makeSeason($this->prosekTeam, '24/25');
        $this->makeRecord($past, $this->playerMembership);

        $names = array_column($this->service->forTeam($this->player, $this->prosekTeam), 'name');

        self::assertContains('24/25', $names);
    }

    public function testStornovanyZapisSamOSobeSezonuNeodemkne(): void
    {
        $past = $this->makeSeason($this->prosekTeam, '24/25');
        $this->makeRecord($past, $this->playerMembership, voided: true);

        $names = array_column($this->service->forTeam($this->player, $this->prosekTeam), 'name');

        self::assertNotContains('24/25', $names);
    }

    public function testSeasonMustStartBeforeItEnds(): void
    {
        try {
            $this->service->create($this->admin, $this->prosekTeam, '26/27', '2027-06-30', '2026-09-01');
            self::fail('sezóna nesmí končit dřív, než začne');
        } catch (ApiException $e) {
            self::assertSame(400, $e->status);
            self::assertSame('VALIDATION_FAILED', $e->errorCode);
        }

        self::assertSame(0, (int) $this->db->value('SELECT COUNT(*) FROM season'));
    }

    public function testDuplicateSeasonNameIsRejected(): void
    {
        $this->service->create($this->admin, $this->prosekTeam, '26/27', '2026-09-01', '2027-06-30');

        try {
            $this->service->create($this->admin, $this->prosekTeam, '26/27', '2026-10-01', '2027-05-31');
            self::fail('dvě sezóny stejného jména v jednom družstvu nedávají smysl');
        } catch (ApiException $e) {
            self::assertSame(409, $e->status);
            self::assertSame('SEASON_EXISTS', $e->errorCode);
        }
    }

    public function testPlayerCannotCreateSeason(): void
    {
        try {
            $this->service->create($this->player, $this->prosekTeam, '26/27', '2026-09-01', '2027-06-30');
            self::fail('hráč nesmí zakládat sezóny');
        } catch (ApiException $e) {
            self::assertSame(403, $e->status);
        }

        self::assertSame(0, (int) $this->db->value('SELECT COUNT(*) FROM season'));
    }

    public function testForeignTeamLooksLikeItDoesNotExist(): void
    {
        try {
            $this->service->forTeam($this->admin, $this->benatkyTeam);
            self::fail('sezóny cizího družstva nejsou vidět');
        } catch (ApiException $e) {
            self::assertSame(404, $e->status);
        }
    }

    public function testListIncludesClosedSeasonsWithRosterCount(): void
    {
        $current = $this->makeSeason($this->prosekTeam, '26/27');
        $closed  = $this->makeSeason($this->prosekTeam, '25/26', '2026-06-30 23:59:59');

        $this->service->setRoster($this->admin, $current, [$this->playerMembership]);

        // Admin vidí historii, hráči jen své.
        $seasons = $this->service->forTeam($this->admin, $this->prosekTeam);
        self::assertCount(2, $seasons);

        $byId = array_column($seasons, null, 'id');
        self::assertSame(1, $byId[$current]['rosterCount']);
        self::assertSame(0, $byId[$closed]['rosterCount']);
        self::assertNotNull($byId[$closed]['closedAt']);
    }

    public function testClosedSeasonCannotBeEdited(): void
    {
        $closed = $this->makeSeason($this->prosekTeam, '25/26', '2026-06-30 23:59:59');

        try {
            $this->service->update($this->admin, $closed, ['name' => 'jinak']);
            self::fail('uzavřenou sezónu nelze upravit');
        } catch (ApiException $e) {
            self::assertSame(409, $e->status);
            self::assertSame('SEASON_CLOSED', $e->errorCode);
        }

        self::assertSame(
            '25/26',
            (string) $this->db->value('SELECT name FROM season WHERE id = ?', [$closed]),
        );
    }

    public function testUpdateKeepsUnsentFieldsAndChecksPeriod(): void
    {
        $season = $this->makeSeason($this->prosekTeam, '26/27');

        $updated = $this->service->update($this->admin, $season, ['name' => '2026/2027']);
        self::assertSame('2026/2027', $updated['name']);
        self::assertSame('2026-09-01', $updated['startsOn']);

        try {
            $this->service->update($this->admin, $season, ['endsOn' => '2026-08-01']);
            self::fail('konec dřív než začátek musí projít validací');
        } catch (ApiException $e) {
            self::assertSame(400, $e->status);
        }
    }

    public function testCloseStampsSeasonAndCannotBeRepeated(): void
    {
        $season = $this->makeSeason($this->prosekTeam, '26/27');

        $closed = $this->service->close($this->admin, $season);
        self::assertNotNull($closed['closedAt']);

        try {
            $this->service->close($this->admin, $season);
            self::fail('už uzavřenou sezónu nelze uzavřít podruhé');
        } catch (ApiException $e) {
            self::assertSame(409, $e->status);
        }
    }

    public function testPlayerCannotCloseSeason(): void
    {
        $season = $this->makeSeason($this->prosekTeam, '26/27');

        try {
            $this->service->close($this->player, $season);
            self::fail('hráč nesmí uzavřít sezónu');
        } catch (ApiException $e) {
            self::assertSame(403, $e->status);
        }

        self::assertNull($this->db->value('SELECT closed_at FROM season WHERE id = ?', [$season]));
    }

    public function testRosterIsReplacedNotAppended(): void
    {
        $season   = $this->makeSeason($this->prosekTeam, '26/27');
        $otherId  = $this->makeUser('druhy@prosek.cz');
        $otherM   = $this->makeMembership($otherId, $this->prosekTeam, 'player');

        $this->service->setRoster($this->admin, $season, [$this->playerMembership, $otherM]);
        self::assertCount(2, $this->service->roster($this->player, $season));

        $roster = $this->service->setRoster($this->admin, $season, [$otherM]);
        self::assertCount(1, $roster);
        self::assertSame($otherM, $roster[0]['membershipId']);

        // Deaktivace místo mazání — kvůli historii.
        self::assertSame(2, (int) $this->db->value('SELECT COUNT(*) FROM roster_entry WHERE season_id = ?', [$season]));
    }

    public function testEmptyRosterClearsIt(): void
    {
        $season = $this->makeSeason($this->prosekTeam, '26/27');

        $this->service->setRoster($this->admin, $season, [$this->playerMembership]);
        self::assertSame([], $this->service->setRoster($this->admin, $season, []));
    }

    public function testRosterRejectsMembershipFromAnotherTeam(): void
    {
        $season     = $this->makeSeason($this->prosekTeam, '26/27');
        $strangerId = $this->makeUser('cizi@benatky.cz');
        $stranger   = $this->makeMembership($strangerId, $this->benatkyTeam, 'player');

        try {
            $this->service->setRoster($this->admin, $season, [$this->playerMembership, $stranger]);
            self::fail('na soupisku se nesmí dostat hráč z jiného družstva');
        } catch (ApiException $e) {
            self::assertSame(400, $e->status);
        }

        self::assertSame(0, (int) $this->db->value('SELECT COUNT(*) FROM roster_entry'));
    }

    public function testPlayerCannotChangeRoster(): void
    {
        $season = $this->makeSeason($this->prosekTeam, '26/27');

        try {
            $this->service->setRoster($this->player, $season, [$this->playerMembership]);
            self::fail('hráč si soupisku nesestavuje');
        } catch (ApiException $e) {
            self::assertSame(403, $e->status);
        }
    }

    public function testRosterOfClosedSeasonIsReadOnly(): void
    {
        $closed = $this->makeSeason($this->prosekTeam, '25/26', '2026-06-30 23:59:59');

        // Číst jde...
        self::assertSame([], $this->service->roster($this->player, $closed));

        // ...zapisovat ne.
        try {
            $this->service->setRoster($this->admin, $closed, [$this->playerMembership]);
            self::fail('soupisku uzavřené sezóny nelze měnit');
        } catch (ApiException $e) {
            self::assertSame(409, $e->status);
            self::assertSame('SEASON_CLOSED', $e->errorCode);
        }
    }

    private function identity(int $userId, string $email, int $teamId, Role $role): Identity
    {
        return new Identity($userId, $email, $email, false, [$teamId => $role]);
    }
}
