<?php

declare(strict_types=1);

namespace Pina\Tests\Integration;

use Pina\Auth\Identity;
use Pina\Auth\Role;
use Pina\Auth\TeamScope;
use Pina\Http\ApiException;

/** Izolace klubů — chyba staré verze. */
final class TeamScopeTest extends DatabaseTestCase
{
    private TeamScope $scope;

    private int $prosekTeam;
    private int $benatkyTeam;
    private int $prosekSeason;
    private int $benatkySeason;
    private Identity $prosekTreasurer;

    protected function setUp(): void
    {
        parent::setUp();

        $this->scope = new TeamScope($this->db);

        [, $this->prosekTeam]  = $this->makeTeam('sk-prosek', 'Prosek - muži');
        [, $this->benatkyTeam] = $this->makeTeam('vk-benatky', 'VK Benátky');

        $this->prosekSeason  = $this->makeSeason($this->prosekTeam, '26/27');
        $this->benatkySeason = $this->makeSeason($this->benatkyTeam, '26/27');

        $userId = $this->makeUser('pinar@prosek.cz');
        $this->makeMembership($userId, $this->prosekTeam, 'treasurer');

        $this->prosekTreasurer = new Identity(
            userId: $userId,
            email: 'pinar@prosek.cz',
            displayName: 'Pínař',
            isPlatformAdmin: false,
            rolesByTeam: [$this->prosekTeam => Role::Treasurer],
        );
    }

    public function testTreasurerReachesOwnSeason(): void
    {
        $teamId = $this->scope->season($this->prosekTreasurer, $this->prosekSeason, Role::Treasurer);

        self::assertSame($this->prosekTeam, $teamId);
    }

    public function testForeignClubLooksLikeItDoesNotExist(): void
    {
        // 404, ne 403 — aby se nezměňovalo, co existuje.
        $this->expectException(ApiException::class);
        $this->expectExceptionCode(0);

        try {
            $this->scope->season($this->prosekTreasurer, $this->benatkySeason, Role::Player);
        } catch (ApiException $e) {
            self::assertSame(404, $e->status);
            self::assertSame('NOT_FOUND', $e->errorCode);

            throw $e;
        }
    }

    public function testPlayerCannotActAsTreasurer(): void
    {
        $userId = $this->makeUser('hrac@prosek.cz');
        $this->makeMembership($userId, $this->prosekTeam, 'player');

        $player = new Identity($userId, 'hrac@prosek.cz', 'Hráč', false, [
            $this->prosekTeam => Role::Player,
        ]);

        try {
            $this->scope->season($player, $this->prosekSeason, Role::Treasurer);
            self::fail('hráč nesmí projít kontrolou na roli pínaře');
        } catch (ApiException $e) {
            self::assertSame(403, $e->status);
        }
    }

    public function testRevokedRoleInDatabaseBeatsToken(): void
    {
        // DB Role nad tokenem — token ještě platí.
        $userId = $this->makeUser('byvaly@prosek.cz');
        $this->makeMembership($userId, $this->prosekTeam, 'player');

        $staleToken = new Identity($userId, 'byvaly@prosek.cz', 'Bývalý', false, [
            $this->prosekTeam => Role::Admin,
        ]);

        try {
            $this->scope->season($staleToken, $this->prosekSeason, Role::Admin);
            self::fail('zastaralý token nesmí povýšit oprávnění');
        } catch (ApiException $e) {
            self::assertSame(403, $e->status);
        }
    }

    public function testMemberWhoLeftLosesAccess(): void
    {
        $userId = $this->makeUser('odesel@prosek.cz');
        $this->makeMembership($userId, $this->prosekTeam, 'player', 'left');

        $identity = new Identity($userId, 'odesel@prosek.cz', 'Odešel', false, [
            $this->prosekTeam => Role::Player,
        ]);

        try {
            $this->scope->season($identity, $this->prosekSeason, Role::Player);
            self::fail('bývalý člen se do týmu nedostane');
        } catch (ApiException $e) {
            self::assertSame(404, $e->status);
        }
    }

    public function testClosedSeasonRejectsWrites(): void
    {
        $closed = $this->makeSeason($this->prosekTeam, '25/26', '2026-06-30 23:59:59');

        // Čtení ano, zápis ne.
        self::assertSame($this->prosekTeam, $this->scope->season($this->prosekTreasurer, $closed, Role::Player));

        try {
            $this->scope->writableSeason($this->prosekTreasurer, $closed, Role::Treasurer);
            self::fail('do uzavřené sezóny nelze zapisovat');
        } catch (ApiException $e) {
            self::assertSame(409, $e->status);
            self::assertSame('SEASON_CLOSED', $e->errorCode);
        }
    }

    public function testPlatformAdminReachesEverything(): void
    {
        $admin = new Identity(1, 'spravce@pinaprosek.eu', 'Správce', true, []);

        self::assertSame(
            $this->benatkyTeam,
            $this->scope->season($admin, $this->benatkySeason, Role::Admin),
        );
    }

    public function testPlayerEditsOwnRecordButNotOthers(): void
    {
        $ownId   = $this->makeUser('ja@prosek.cz');
        $otherId = $this->makeUser('kolega@prosek.cz');
        $ownM    = $this->makeMembership($ownId, $this->prosekTeam, 'player');
        $otherM  = $this->makeMembership($otherId, $this->prosekTeam, 'player');

        $player = new Identity($ownId, 'ja@prosek.cz', 'Já', false, [
            $this->prosekTeam => Role::Player,
        ]);

        // Své ano, cizí ne.
        self::assertSame(
            $this->prosekTeam,
            $this->scope->ownMembershipOr($player, $ownM, Role::Treasurer),
        );

        try {
            $this->scope->ownMembershipOr($player, $otherM, Role::Treasurer);
            self::fail('hráč nesmí měnit záznam spoluhráče');
        } catch (ApiException $e) {
            self::assertSame(403, $e->status);
        }
    }

    public function testNonexistentIdIsNotFound(): void
    {
        try {
            $this->scope->season($this->prosekTreasurer, 999999, Role::Player);
            self::fail('neexistující sezóna má vrátit 404');
        } catch (ApiException $e) {
            self::assertSame(404, $e->status);
        }
    }
}
