<?php

declare(strict_types=1);

namespace Pina\Tests\Integration;

use Pina\Auth\Identity;
use Pina\Auth\Role;
use Pina\Auth\TeamScope;
use Pina\Auth\TokenService;
use Pina\Http\ApiException;
use Pina\Service\TeamService;

/**
 * Správa družstev. Těžiště testů je na izolaci klubů a na rolích — přesně tam,
 * kde stará verze neměla žádnou kontrolu.
 */
final class TeamServiceTest extends DatabaseTestCase
{
    private TeamService $service;

    private int $prosekClub;
    private int $prosekTeam;
    private int $benatkyClub;
    private int $benatkyTeam;

    private Identity $admin;
    private Identity $player;
    private int $playerMembership;

    protected function setUp(): void
    {
        parent::setUp();

        $this->service = new TeamService(
            $this->db,
            new TeamScope($this->db),
            new TokenService($this->db),
        );

        [$this->prosekClub, $this->prosekTeam]   = $this->makeTeam('sk-prosek', 'Prosek - muži');
        [$this->benatkyClub, $this->benatkyTeam] = $this->makeTeam('vk-benatky', 'VK Benátky');

        $adminId = $this->makeUser('admin@prosek.cz');
        $this->makeMembership($adminId, $this->prosekTeam, 'admin');
        $this->admin = $this->identity($adminId, 'admin@prosek.cz', $this->prosekTeam, Role::Admin);

        $playerId               = $this->makeUser('hrac@prosek.cz');
        $this->playerMembership = $this->makeMembership($playerId, $this->prosekTeam, 'player');
        $this->player           = $this->identity($playerId, 'hrac@prosek.cz', $this->prosekTeam, Role::Player);
    }

    public function testMyTeamsListsOnlyOwnMemberships(): void
    {
        // Admin Prosku je zároveň hráčem Benátek — musí vidět obě družstva a v každém
        // svou vlastní roli.
        $this->makeMembership($this->admin->userId, $this->benatkyTeam, 'player');

        $teams = $this->service->myTeams($this->admin);

        self::assertCount(2, $teams);

        $roles = array_column($teams, 'role', 'id');
        self::assertSame('admin', $roles[$this->prosekTeam]);
        self::assertSame('player', $roles[$this->benatkyTeam]);
    }

    public function testMyTeamsSkipsTeamsWhereMemberLeft(): void
    {
        $userId = $this->makeUser('odesel@prosek.cz');
        $this->makeMembership($userId, $this->prosekTeam, 'player', 'left');

        $identity = $this->identity($userId, 'odesel@prosek.cz', $this->prosekTeam, Role::Player);

        self::assertSame([], $this->service->myTeams($identity));
    }

    public function testDetailIncludesDefaultSettings(): void
    {
        $detail = $this->service->detail($this->player, $this->prosekTeam);

        self::assertSame('Prosek - muži', $detail['name']);
        self::assertSame($this->prosekClub, $detail['clubId']);
        self::assertSame(2, $detail['memberCount']);

        // Řádek v team_settings ještě neexistuje, platí výchozí hodnoty ze schématu.
        self::assertFalse($detail['settings']['travelEnabled']);
        self::assertSame(5.0, $detail['settings']['travelRateCzkKm']);
        self::assertTrue($detail['settings']['balancesVisibleToPlayers']);
    }

    public function testForeignTeamLooksLikeItDoesNotExist(): void
    {
        try {
            $this->service->detail($this->admin, $this->benatkyTeam);
            self::fail('cizí družstvo musí vypadat jako neexistující');
        } catch (ApiException $e) {
            self::assertSame(404, $e->status);
            self::assertSame('NOT_FOUND', $e->errorCode);
        }
    }

    public function testAdminRenamesTeam(): void
    {
        $detail = $this->service->update($this->admin, $this->prosekTeam, [
            'name'  => 'Prosek A',
            'color' => '#00aa55',
        ]);

        self::assertSame('Prosek A', $detail['name']);
        self::assertSame('#00aa55', $detail['color']);
    }

    public function testPlayerCannotRenameTeam(): void
    {
        try {
            $this->service->update($this->player, $this->prosekTeam, ['name' => 'Hráčův tým']);
            self::fail('hráč nesmí přejmenovat družstvo');
        } catch (ApiException $e) {
            self::assertSame(403, $e->status);
        }

        self::assertSame(
            'Prosek - muži',
            (string) $this->db->value('SELECT name FROM team WHERE id = ?', [$this->prosekTeam]),
        );
    }

    public function testMembersAreVisibleToPlayers(): void
    {
        $members = $this->service->members($this->player, $this->prosekTeam);

        self::assertCount(2, $members);

        $byEmail = array_column($members, null, 'email');
        self::assertSame('admin', $byEmail['admin@prosek.cz']['role']);
        self::assertSame('active', $byEmail['hrac@prosek.cz']['status']);
        self::assertNotSame('', $byEmail['hrac@prosek.cz']['paymentReference']);
    }

    public function testInvitationStoresOnlyHash(): void
    {
        $invitation = $this->service->invite($this->admin, $this->prosekTeam, 'Novy@Prosek.cz', Role::Treasurer);

        self::assertSame('novy@prosek.cz', $invitation['email']);
        self::assertSame('treasurer', $invitation['role']);
        self::assertSame(64, strlen($invitation['token']));

        $row = $this->db->first(
            'SELECT token_hash, team_id, TIMESTAMPDIFF(SECOND, NOW(), expires_at) AS lifetime
               FROM invitation WHERE id = ?',
            [$invitation['id']],
        );

        self::assertNotNull($row);
        self::assertSame(hash('sha256', $invitation['token']), (string) $row['token_hash']);
        self::assertSame($this->prosekTeam, (int) $row['team_id']);

        // Platnost 72 hodin. Počítá se dotazem v databázi, aby výsledek nezávisel
        // na tom, jakou časovou zónu má nastavené PHP.
        self::assertGreaterThan(71 * 3600, (int) $row['lifetime']);
        self::assertLessThanOrEqual(72 * 3600, (int) $row['lifetime']);
    }

    public function testInvitationRejectsExistingMember(): void
    {
        try {
            $this->service->invite($this->admin, $this->prosekTeam, 'hrac@prosek.cz', Role::Player);
            self::fail('stávajícího člena nelze pozvat znovu');
        } catch (ApiException $e) {
            self::assertSame(409, $e->status);
            self::assertSame('MEMBER_EXISTS', $e->errorCode);
        }
    }

    public function testPlayerCannotInvite(): void
    {
        try {
            $this->service->invite($this->player, $this->prosekTeam, 'kamarad@prosek.cz', Role::Admin);
            self::fail('hráč nesmí zvát nové členy');
        } catch (ApiException $e) {
            self::assertSame(403, $e->status);
        }

        self::assertSame(0, (int) $this->db->value('SELECT COUNT(*) FROM invitation'));
    }

    public function testRoleChangeInvalidatesIssuedTokens(): void
    {
        $userId = $this->db->value('SELECT user_id FROM membership WHERE id = ?', [$this->playerMembership]);
        $this->db->run(
            "UPDATE `user` SET tokens_valid_from = '2020-01-01 00:00:00' WHERE id = ?",
            [$userId],
        );

        $member = $this->service->updateMembership($this->admin, $this->playerMembership, [
            'role'         => Role::Treasurer,
            'jerseyNumber' => 7,
        ]);

        self::assertSame('treasurer', $member['role']);
        self::assertSame(7, $member['jerseyNumber']);

        // Vydaný JWT tvrdí, že jde o hráče; razítko se musí posunout, aby přestal platit.
        self::assertNotSame(
            '2020-01-01 00:00:00',
            (string) $this->db->value('SELECT tokens_valid_from FROM `user` WHERE id = ?', [$userId]),
        );
    }

    public function testMembershipMarkedLeftGetsDate(): void
    {
        $member = $this->service->updateMembership($this->admin, $this->playerMembership, ['status' => 'left']);

        self::assertSame('left', $member['status']);
        self::assertNotNull($this->db->value('SELECT left_at FROM membership WHERE id = ?', [
            $this->playerMembership,
        ]));
    }

    public function testPlayerCannotChangeOwnRole(): void
    {
        try {
            $this->service->updateMembership($this->player, $this->playerMembership, ['role' => Role::Admin]);
            self::fail('hráč se nesmí povýšit na admina');
        } catch (ApiException $e) {
            self::assertSame(403, $e->status);
        }

        self::assertSame(
            'player',
            (string) $this->db->value('SELECT role FROM membership WHERE id = ?', [$this->playerMembership]),
        );
    }

    public function testForeignMembershipIsNotFound(): void
    {
        $strangerId = $this->makeUser('cizi@benatky.cz');
        $membership = $this->makeMembership($strangerId, $this->benatkyTeam, 'player');

        try {
            $this->service->updateMembership($this->admin, $membership, ['role' => Role::Player]);
            self::fail('admin Prosku nesmí sáhnout na členství v Benátkách');
        } catch (ApiException $e) {
            self::assertSame(404, $e->status);
        }
    }

    public function testAdminSavesSettingsAndOverwritesThem(): void
    {
        $first = $this->service->saveSettings($this->admin, $this->prosekTeam, $this->settings([
            'travelEnabled'   => true,
            'travelRateCzkKm' => 6.5,
        ]));

        self::assertTrue($first['travelEnabled']);
        self::assertSame(6.5, $first['travelRateCzkKm']);

        // Druhé uložení jde přes ON DUPLICATE KEY UPDATE — nesmí spadnout ani založit druhý řádek.
        $second = $this->service->saveSettings($this->admin, $this->prosekTeam, $this->settings([
            'travelEnabled'    => false,
            'travelRateCzkKm'  => 8.0,
            'settlementPeriod' => 'half_year',
        ]));

        self::assertFalse($second['travelEnabled']);
        self::assertSame(8.0, $second['travelRateCzkKm']);
        self::assertSame('half_year', $second['settlementPeriod']);
        self::assertSame(1, (int) $this->db->value('SELECT COUNT(*) FROM team_settings'));
    }

    public function testPlayerCannotChangeSettings(): void
    {
        try {
            $this->service->saveSettings($this->player, $this->prosekTeam, $this->settings(['travelEnabled' => true]));
            self::fail('hráč nesmí měnit nastavení družstva');
        } catch (ApiException $e) {
            self::assertSame(403, $e->status);
        }

        self::assertSame(0, (int) $this->db->value('SELECT COUNT(*) FROM team_settings'));
    }

    public function testHomeLocationMustBelongToSameClub(): void
    {
        $foreign = $this->makeLocation($this->benatkyClub, 'Hala Benátky');

        try {
            $this->service->saveSettings($this->admin, $this->prosekTeam, $this->settings([
                'homeLocationId' => $foreign,
            ]));
            self::fail('domácí hala z cizího klubu se nesmí uložit');
        } catch (ApiException $e) {
            self::assertSame(400, $e->status);
        }

        $own     = $this->makeLocation($this->prosekClub, 'Hala Prosek');
        $settings = $this->service->saveSettings($this->admin, $this->prosekTeam, $this->settings([
            'homeLocationId' => $own,
        ]));

        self::assertSame($own, $settings['homeLocationId']);
    }

    /**
     * @param  array<string,mixed> $overrides
     * @return array{
     *     travelEnabled:bool,
     *     travelRateCzkKm:float,
     *     travelRoundTrip:bool,
     *     settlementPeriod:string,
     *     homeLocationId:int|null,
     *     attendanceVisibleToPlayers:bool,
     *     balancesVisibleToPlayers:bool
     * }
     */
    private function settings(array $overrides = []): array
    {
        /** @var array{
         *     travelEnabled:bool,
         *     travelRateCzkKm:float,
         *     travelRoundTrip:bool,
         *     settlementPeriod:string,
         *     homeLocationId:int|null,
         *     attendanceVisibleToPlayers:bool,
         *     balancesVisibleToPlayers:bool
         * } $settings
         */
        $settings = [
            'travelEnabled'              => false,
            'travelRateCzkKm'            => 5.0,
            'travelRoundTrip'            => true,
            'settlementPeriod'           => 'none',
            'homeLocationId'             => null,
            'attendanceVisibleToPlayers' => false,
            'balancesVisibleToPlayers'   => true,
            ...$overrides,
        ];

        return $settings;
    }

    private function makeLocation(int $clubId, string $name): int
    {
        $this->db->run('INSERT INTO location (club_id, name) VALUES (?, ?)', [$clubId, $name]);

        return $this->db->lastInsertId();
    }

    private function identity(int $userId, string $email, int $teamId, Role $role): Identity
    {
        return new Identity($userId, $email, $email, false, [$teamId => $role]);
    }
}
