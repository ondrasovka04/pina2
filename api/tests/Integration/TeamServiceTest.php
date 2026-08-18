<?php

declare(strict_types=1);

namespace Pina\Tests\Integration;

use Pina\Auth\Identity;
use Pina\Auth\Role;
use Pina\Auth\TeamScope;
use Pina\Auth\TokenService;
use Pina\Http\ApiException;
use Pina\Mail\InvitationMail;
use Pina\Service\TeamService;
use Pina\Tests\Support\FakeMailer;

/** Izolace klubů a role — hlavní problém staré verze. */
final class TeamServiceTest extends DatabaseTestCase
{
    private TeamService $service;
    private FakeMailer $mailer;

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

        $this->mailer  = new FakeMailer();
        $this->service = new TeamService(
            $this->db,
            new TeamScope($this->db),
            new TokenService($this->db),
            new InvitationMail($this->mailer, 'https://pinaprosek.eu'),
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
        // Jeden člověk v dvou týmech → dvě membership, v každém jiná role.
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

        // Výchozí hodnoty bez řádku v DB.
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

        // Platnost ~72 hodin.
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

    public function testInvitationIsSentByEmailButLinkComesBackAnyway(): void
    {
        $invitation = $this->service->invite($this->admin, $this->prosekTeam, 'novy@prosek.cz', Role::Player);

        self::assertTrue($invitation['emailSent']);
        self::assertSame(['novy@prosek.cz'], $this->mailer->recipients());

        // I po úspěšném odeslání — na případ spamu.
        self::assertStringContainsString(
            'https://pinaprosek.eu/pozvanka?token=' . $invitation['token'],
            (string) $this->mailer->last(),
        );
    }

    public function testInviteCanSkipTheEmail(): void
    {
        $invitation = $this->service->invite(
            $this->admin,
            $this->prosekTeam,
            'novy@prosek.cz',
            Role::Player,
            sendEmail: false,
        );

        self::assertFalse($invitation['emailSent']);
        self::assertSame([], $this->mailer->sent);
        self::assertSame(64, strlen($invitation['token']));
    }

    public function testInviteSurvivesMailOutage(): void
    {
        $service = new TeamService(
            $this->db,
            new TeamScope($this->db),
            new TokenService($this->db),
            new InvitationMail(new FakeMailer(enabled: false), 'https://pinaprosek.eu'),
        );

        $invitation = $service->invite($this->admin, $this->prosekTeam, 'novy@prosek.cz', Role::Player);

        // Pozvánka vznikne i bez pošty.
        self::assertFalse($invitation['emailSent']);
        self::assertSame(1, (int) $this->db->value('SELECT COUNT(*) FROM invitation'));
    }

    public function testResendReplacesTheOldToken(): void
    {
        $first = $this->service->invite($this->admin, $this->prosekTeam, 'novy@prosek.cz', Role::Player);
        $this->ageInvitation($first['id']);

        $second = $this->service->resendInvitation($this->admin, $first['id']);

        self::assertNotSame($first['token'], $second['token']);
        self::assertSame('novy@prosek.cz', $second['email']);
        self::assertSame('player', $second['role']);

        // Starý zneplatněn.
        self::assertNull($this->db->value(
            'SELECT id FROM invitation WHERE token_hash = ?',
            [hash('sha256', $first['token'])],
        ));

        // Jen jeden aktuální.
        self::assertSame(1, (int) $this->db->value('SELECT COUNT(*) FROM invitation'));
    }

    public function testResendIsRateLimited(): void
    {
        $invitation = $this->service->invite($this->admin, $this->prosekTeam, 'novy@prosek.cz', Role::Player);

        try {
            $this->service->resendInvitation($this->admin, $invitation['id']);
            self::fail('bez čekání');
        } catch (ApiException $e) {
            self::assertSame(429, $e->status);
        }

        self::assertCount(1, $this->mailer->sent);
    }

    public function testActivationEmailsGoOutInBatches(): void
    {
        // Migrace: spousty účtů bez hesla.
        for ($i = 0; $i < 30; $i++) {
            $this->makeMembership($this->makeUser("hrac$i@prosek.cz"), $this->prosekTeam, 'player');
        }

        $this->db->run("UPDATE `user` SET password_hash = 'x' WHERE email = 'admin@prosek.cz'");

        $first = $this->service->sendActivationEmails($this->admin, $this->prosekTeam);

        // 31 bez hesla, dávka po 25.
        self::assertSame(25, $first['sent']);
        self::assertSame(6, $first['remaining']);
        self::assertSame(0, $first['skipped']);

        $second = $this->service->sendActivationEmails($this->admin, $this->prosekTeam);

        self::assertSame(6, $second['sent']);
        self::assertSame(0, $second['remaining']);
        self::assertCount(31, $this->mailer->sent);

        // Admin má heslo, žádná zpráva.
        self::assertNotContains('admin@prosek.cz', $this->mailer->recipients());
    }

    public function testUndeliveredActivationDoesNotBlockTheNextAttempt(): void
    {
        // Neodeslané se vymažou — aby nového pokus neblokovalo.
        $mailer  = new FakeMailer();
        $service = new TeamService(
            $this->db,
            new TeamScope($this->db),
            new TokenService($this->db),
            new InvitationMail($mailer, 'https://pinaprosek.eu'),
        );

        $this->db->run("UPDATE `user` SET password_hash = 'x' WHERE email = 'admin@prosek.cz'");

        $mailer->refuseAll = true;
        $first             = $service->sendActivationEmails($this->admin, $this->prosekTeam);

        self::assertSame(0, $first['sent']);
        self::assertSame(1, $first['failed']);
        self::assertSame(0, (int) $this->db->value('SELECT COUNT(*) FROM invitation'));

        $mailer->refuseAll = false;
        $second            = $service->sendActivationEmails($this->admin, $this->prosekTeam);

        self::assertSame(1, $second['sent']);
        self::assertSame(['hrac@prosek.cz'], $mailer->recipients());
    }

    public function testActivationEmailGoesOutOncePerPersonNotPerTeam(): void
    {
        // Člověk v několika týmech → jedna zpráva, ne vícekrát.
        [, $juniors] = $this->makeTeam('sk-prosek-junior', 'Prosek - junioři');
        $this->makeMembership($this->admin->userId, $juniors, 'admin');

        $userId = (int) $this->db->value('SELECT user_id FROM membership WHERE id = ?', [$this->playerMembership]);
        $this->makeMembership($userId, $juniors, 'player');
        $this->db->run("UPDATE `user` SET password_hash = 'x' WHERE id = ?", [$this->admin->userId]);

        $first  = $this->service->sendActivationEmails($this->admin, $this->prosekTeam);
        $second = $this->service->sendActivationEmails($this->admin, $juniors);

        self::assertSame(1, $first['sent']);
        self::assertSame(0, $second['sent']);
        self::assertSame(['hrac@prosek.cz'], $this->mailer->recipients());
    }

    public function testActivationEmailsSkipPlaceholderAddresses(): void
    {
        // Zástupné adresy (migrace) se vynechají.
        $this->makeMembership($this->makeUser('legacy-7@pinaprosek.invalid'), $this->prosekTeam, 'player');

        $result = $this->service->sendActivationEmails($this->admin, $this->prosekTeam);

        self::assertSame(1, $result['skipped']);
        self::assertNotContains('legacy-7@pinaprosek.invalid', $this->mailer->recipients());
    }

    public function testBulkActivationRefusedWhenMailIsOff(): void
    {
        $service = new TeamService(
            $this->db,
            new TeamScope($this->db),
            new TokenService($this->db),
            new InvitationMail(new FakeMailer(enabled: false), 'https://pinaprosek.eu'),
        );

        try {
            $service->sendActivationEmails($this->admin, $this->prosekTeam);
            self::fail('bez pošty');
        } catch (ApiException $e) {
            self::assertSame('MAIL_DISABLED', $e->errorCode);
        }

        // Tokeny se nevytvoří.
        self::assertSame(0, (int) $this->db->value('SELECT COUNT(*) FROM invitation'));
    }

    public function testActivationEmailUsesMembersCurrentRole(): void
    {
        $this->service->updateMembership($this->admin, $this->playerMembership, ['role' => Role::Treasurer]);

        $activation = $this->service->activationLink($this->admin, $this->playerMembership);

        self::assertTrue($activation['emailSent']);
        self::assertSame('treasurer', $activation['role']);
        self::assertSame(['hrac@prosek.cz'], $this->mailer->recipients());
    }

    public function testFounderOfTeamBecomesItsAdmin(): void
    {
        // Zakladatel je admin nového týmu.
        $team = $this->service->createTeam($this->admin, $this->prosekClub, 'Prosek - junioři', '#062372');

        self::assertSame('Prosek - junioři', $team['name']);
        self::assertSame($this->prosekClub, $team['clubId']);
        self::assertSame(1, $team['memberCount']);

        $membership = $this->db->first(
            'SELECT role, status, payment_reference FROM membership WHERE team_id = ? AND user_id = ?',
            [$team['id'], $this->admin->userId],
        );

        self::assertNotNull($membership);
        self::assertSame('admin', (string) $membership['role']);
        self::assertSame('active', (string) $membership['status']);
        self::assertNotSame('', (string) $membership['payment_reference']);
    }

    public function testFoundersTokensAreInvalidatedSoNewTeamIsVisible(): void
    {
        $this->db->run(
            "UPDATE `user` SET tokens_valid_from = '2020-01-01 00:00:00' WHERE id = ?",
            [$this->admin->userId],
        );

        $this->service->createTeam($this->admin, $this->prosekClub, 'Prosek - kadeti', null);

        // Razítko se posune — stará tokeny padnou.
        self::assertNotSame(
            '2020-01-01 00:00:00',
            (string) $this->db->value('SELECT tokens_valid_from FROM `user` WHERE id = ?', [$this->admin->userId]),
        );
    }

    public function testPlayerCannotFoundTeamInHisClub(): void
    {
        try {
            $this->service->createTeam($this->player, $this->prosekClub, 'Prosek - béčko', null);
            self::fail('hráč nesmí zakládat družstva');
        } catch (ApiException $e) {
            self::assertSame(404, $e->status);
        }
    }

    public function testAdminCannotFoundTeamInForeignClub(): void
    {
        try {
            $this->service->createTeam($this->admin, $this->benatkyClub, 'Benátky - béčko', null);
            self::fail('admin Prosku nesmí zakládat družstva v Benátkách');
        } catch (ApiException $e) {
            self::assertSame(404, $e->status);
        }

        self::assertSame(
            1,
            (int) $this->db->value('SELECT COUNT(*) FROM team WHERE club_id = ?', [$this->benatkyClub]),
        );
    }

    public function testDuplicateTeamNameInClubIsRejected(): void
    {
        try {
            $this->service->createTeam($this->admin, $this->prosekClub, 'Prosek - muži', null);
            self::fail('dvě družstva téhož jména by v klubu nešla rozlišit');
        } catch (ApiException $e) {
            self::assertSame(409, $e->status);
            self::assertSame('TEAM_EXISTS', $e->errorCode);
        }
    }

    public function testPlatformOverviewShowsHealthOfEveryClub(): void
    {
        $this->db->run("UPDATE `user` SET password_hash = 'x' WHERE email = 'admin@prosek.cz'");
        $season = $this->makeSeason($this->prosekTeam, '26/27');
        $this->db->run('UPDATE season SET is_current = 1 WHERE id = ?', [$season]);

        $clubs = $this->service->platformOverview($this->platformAdmin());

        self::assertCount(2, $clubs);

        $prosek = array_values(array_filter($clubs, fn (array $c): bool => $c['id'] === $this->prosekClub))[0];
        self::assertCount(1, $prosek['teams']);

        $team = $prosek['teams'][0];
        self::assertSame(2, $team['memberCount']);
        self::assertSame(1, $team['adminCount']);
        // Jen jeden aktivní.
        self::assertSame(1, $team['activatedCount']);
        self::assertSame('26/27', $team['currentSeason']);
        self::assertSame(1, $team['seasonCount']);
    }

    public function testPlatformOverviewListsClubWithoutAnyTeam(): void
    {
        // Prázdný klub se ukazuje — aby správce věděl, co dál.
        $platform = $this->platformAdmin();
        $this->service->createClub($platform, 'Nový klub');

        $novy = array_values(array_filter(
            $this->service->platformOverview($platform),
            static fn (array $club): bool => $club['name'] === 'Nový klub',
        ));

        self::assertCount(1, $novy);
        self::assertSame([], $novy[0]['teams']);
    }

    public function testPlatformOverviewIsClosedToTeamAdmins(): void
    {
        // Admin týmu není admin platformy.
        try {
            $this->service->platformOverview($this->admin);
            self::fail('není přístup');
        } catch (ApiException $e) {
            self::assertSame(403, $e->status);
        }
    }

    public function testOnlyPlatformAdminFoundsClub(): void
    {
        try {
            $this->service->createClub($this->admin, 'VK Kbely');
            self::fail('admin družstva nesmí zakládat nové kluby');
        } catch (ApiException $e) {
            self::assertSame(403, $e->status);
        }

        $club = $this->service->createClub($this->platformAdmin(), 'VK Kbely');

        self::assertSame('VK Kbely', $club['name']);
        self::assertSame('vk-kbely', $club['slug']);
    }

    public function testClubSlugsDoNotCollide(): void
    {
        $platform = $this->platformAdmin();

        $first  = $this->service->createClub($platform, 'Sokol Žižkov');
        $second = $this->service->createClub($platform, 'Sokol Žižkov');

        // Číslování místo chyby.
        self::assertSame('sokol-zizkov', $first['slug']);
        self::assertSame('sokol-zizkov-2', $second['slug']);
    }

    public function testLastAdminCannotBeDemoted(): void
    {
        $adminMembership = (int) $this->db->value(
            'SELECT id FROM membership WHERE team_id = ? AND user_id = ?',
            [$this->prosekTeam, $this->admin->userId],
        );

        try {
            $this->service->updateMembership($this->admin, $adminMembership, ['role' => Role::Treasurer]);
            self::fail('družstvo by zůstalo bez admina');
        } catch (ApiException $e) {
            self::assertSame(409, $e->status);
            self::assertSame('LAST_ADMIN', $e->errorCode);
        }

        self::assertSame(
            'admin',
            (string) $this->db->value('SELECT role FROM membership WHERE id = ?', [$adminMembership]),
        );
    }

    public function testLastAdminCannotLeaveTeam(): void
    {
        $adminMembership = (int) $this->db->value(
            'SELECT id FROM membership WHERE team_id = ? AND user_id = ?',
            [$this->prosekTeam, $this->admin->userId],
        );

        try {
            $this->service->updateMembership($this->admin, $adminMembership, ['status' => 'left']);
            self::fail('poslední admin nesmí z družstva odejít');
        } catch (ApiException $e) {
            self::assertSame('LAST_ADMIN', $e->errorCode);
        }
    }

    public function testAdminCanStepDownAfterNamingSuccessor(): void
    {
        $adminMembership = (int) $this->db->value(
            'SELECT id FROM membership WHERE team_id = ? AND user_id = ?',
            [$this->prosekTeam, $this->admin->userId],
        );

        // Předání role se dělá v tomhle pořadí: nejdřív nástupce, pak sebe.
        $this->service->updateMembership($this->admin, $this->playerMembership, ['role' => Role::Admin]);
        $former = $this->service->updateMembership($this->admin, $adminMembership, ['role' => Role::Player]);

        self::assertSame('player', $former['role']);
    }

    public function testActivationLinkLetsMigratedMemberSetPassword(): void
    {
        // Hesla ze staré aplikace se nemigrovala, takže drtivá většina účtů se
        // nemá čím přihlásit. Pozvánka na ně nesedne — jsou to stávající členové.
        $activation = $this->service->activationLink($this->admin, $this->playerMembership);

        self::assertSame('hrac@prosek.cz', $activation['email']);
        self::assertSame('player', $activation['role']);
        self::assertSame(64, strlen($activation['token']));

        // V databázi zůstává jen otisk, stejně jako u pozvánky.
        $stored = $this->db->first(
            'SELECT token_hash, team_id, role FROM invitation WHERE email = ?',
            ['hrac@prosek.cz'],
        );

        self::assertNotNull($stored);
        self::assertSame(hash('sha256', $activation['token']), (string) $stored['token_hash']);
        self::assertSame($this->prosekTeam, (int) $stored['team_id']);
        self::assertSame('player', (string) $stored['role']);
    }

    public function testActivationLinkRefusedWhenMemberAlreadyHasPassword(): void
    {
        $this->db->run(
            "UPDATE `user` SET password_hash = 'x' WHERE id = (SELECT user_id FROM membership WHERE id = ?)",
            [$this->playerMembership],
        );

        try {
            $this->service->activationLink($this->admin, $this->playerMembership);
            self::fail('aktivační odkaz nesmí sloužit k převzetí cizího účtu');
        } catch (ApiException $e) {
            self::assertSame(409, $e->status);
            self::assertSame('PASSWORD_ALREADY_SET', $e->errorCode);
        }

        self::assertSame(0, (int) $this->db->value('SELECT COUNT(*) FROM invitation'));
    }

    public function testPlayerCannotCreateActivationLink(): void
    {
        try {
            $this->service->activationLink($this->player, $this->playerMembership);
            self::fail('hráč si nesmí vyrobit odkaz ani sám na sebe');
        } catch (ApiException $e) {
            self::assertSame(403, $e->status);
        }
    }

    public function testInvitationListNeverExposesToken(): void
    {
        $created = $this->service->invite($this->admin, $this->prosekTeam, 'novy@prosek.cz', Role::Player);

        $pending = $this->service->invitations($this->admin, $this->prosekTeam);

        self::assertCount(1, $pending);
        self::assertSame('novy@prosek.cz', $pending[0]['email']);
        self::assertFalse($pending[0]['expired']);
        self::assertArrayNotHasKey('token', $pending[0]);

        $this->service->revokeInvitation($this->admin, $created['id']);

        self::assertSame([], $this->service->invitations($this->admin, $this->prosekTeam));
    }

    public function testAcceptedInvitationCannotBeRevoked(): void
    {
        $created = $this->service->invite($this->admin, $this->prosekTeam, 'novy@prosek.cz', Role::Player);
        $this->db->run('UPDATE invitation SET accepted_at = NOW() WHERE id = ?', [$created['id']]);

        try {
            $this->service->revokeInvitation($this->admin, $created['id']);
            self::fail('přijatou pozvánku nelze vzít zpět, členství už existuje');
        } catch (ApiException $e) {
            self::assertSame(409, $e->status);
            self::assertSame('INVITATION_ACCEPTED', $e->errorCode);
        }
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

    public function testAdminRenamesPlayerEverywhere(): void
    {
        // Jméno na uživateli → změní se všude.
        [, $juniors] = $this->makeTeam('sk-prosek-junior', 'Prosek - junioři');
        $userId      = (int) $this->db->value('SELECT user_id FROM membership WHERE id = ?', [$this->playerMembership]);
        $this->makeMembership($userId, $juniors, 'player');

        $member = $this->service->updateMembership($this->admin, $this->playerMembership, ['name' => '  Petr Novák  ']);

        self::assertSame('Petr Novák', $member['name']);
        self::assertSame(
            'Petr Novák',
            (string) $this->db->value('SELECT display_name FROM `user` WHERE id = ?', [$userId]),
        );
    }

    public function testRenameAloneIsEnoughOfAChange(): void
    {
        // Jméno na uživateli, ne v membership, ale je to platná změna.
        $member = $this->service->updateMembership($this->admin, $this->playerMembership, ['name' => 'Petr']);

        self::assertSame('Petr', $member['name']);
        self::assertSame('player', $member['role']);
    }

    public function testEmptyNameIsRejected(): void
    {
        try {
            $this->service->updateMembership($this->admin, $this->playerMembership, ['name' => '   ']);
            self::fail('bez jména');
        } catch (ApiException $e) {
            self::assertSame(400, $e->status);
            self::assertSame('name', $e->details['field'] ?? null);
        }
    }

    public function testPlayerCannotRenameAnyone(): void
    {
        try {
            $this->service->updateMembership($this->player, $this->playerMembership, ['name' => 'Kdokoli']);
            self::fail('bez práv');
        } catch (ApiException $e) {
            self::assertSame(403, $e->status);
        }

        self::assertSame(
            'hrac',
            (string) $this->db->value('SELECT display_name FROM `user` WHERE email = ?', ['hrac@prosek.cz']),
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
            'bankAccount'     => '19-2000145399/0800',
        ]));

        self::assertTrue($first['travelEnabled']);
        self::assertSame(6.5, $first['travelRateCzkKm']);
        self::assertSame('19-2000145399/0800', $first['bankAccount']);

        // Druhé: přepsání bez duplikátu.
        $second = $this->service->saveSettings($this->admin, $this->prosekTeam, $this->settings([
            'travelEnabled'   => false,
            'travelRateCzkKm' => 8.0,
        ]));

        self::assertFalse($second['travelEnabled']);
        self::assertSame(8.0, $second['travelRateCzkKm']);
        self::assertSame(1, (int) $this->db->value('SELECT COUNT(*) FROM team_settings'));
        self::assertNull($this->db->value('SELECT bank_account FROM team_settings WHERE team_id = ?', [$this->prosekTeam]));
    }

    /**
     * Účet patří družstvu, ne klubu. Do F4 ležel na klubu a editoval se v nastavení
     * družstva, takže změna u mužů tiše přepsala účet juniorům i kadetům.
     */
    public function testBankAccountIsNotSharedWithSiblingTeam(): void
    {
        $juniors = $this->makeTeamInClub($this->prosekClub, 'Junioři');
        $this->makeMembership($this->admin->userId, $juniors, 'admin');
        $admin = new Identity($this->admin->userId, 'admin@prosek.cz', 'admin', false, [
            $this->prosekTeam => Role::Admin,
            $juniors          => Role::Admin,
        ]);

        $this->service->saveSettings($admin, $this->prosekTeam, $this->settings([
            'bankAccount' => '19-2000145399/0800',
        ]));
        $this->service->saveSettings($admin, $juniors, $this->settings([
            'bankAccount' => '2702016516/2010',
        ]));

        // Uložení juniorům nesmí přepsat muže — dřív šlo obojí do jednoho řádku klubu.
        self::assertSame('19-2000145399/0800', $this->service->detail($admin, $this->prosekTeam)['settings']['bankAccount']);
        self::assertSame('2702016516/2010', $this->service->detail($admin, $juniors)['settings']['bankAccount']);
    }

    public function testInvalidBankAccountIsRejected(): void
    {
        try {
            $this->service->saveSettings($this->admin, $this->prosekTeam, $this->settings([
                'bankAccount' => 'účet někam',
            ]));
            self::fail('Neplatný účet se nesmí uložit.');
        } catch (ApiException $e) {
            self::assertSame(400, $e->status);
            self::assertSame('bankAccount', $e->details['field'] ?? null);
        }
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
            self::fail('cizí hala');
        } catch (ApiException $e) {
            self::assertSame(400, $e->status);
        }

        $own      = $this->makeLocation($this->prosekClub, 'Hala Prosek');
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
     *     homeLocationId:int|null,
     *     attendanceVisibleToPlayers:bool,
     *     balancesVisibleToPlayers:bool,
     *     bankAccount:string|null
     * }
     */
    private function settings(array $overrides = []): array
    {
        /** @var array{
         *     travelEnabled:bool,
         *     travelRateCzkKm:float,
         *     travelRoundTrip:bool,
             *     homeLocationId:int|null,
         *     attendanceVisibleToPlayers:bool,
         *     balancesVisibleToPlayers:bool,
         *     bankAccount:string|null
         * } $settings
         */
        $settings = [
            'travelEnabled'              => false,
            'travelRateCzkKm'            => 5.0,
            'travelRoundTrip'            => true,
            'homeLocationId'             => null,
            'attendanceVisibleToPlayers' => false,
            'balancesVisibleToPlayers'   => true,
            'bankAccount'                => null,
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

    /** Do minulosti pro přeslání bez čekání. */
    private function ageInvitation(int $invitationId): void
    {
        $this->db->run(
            'UPDATE invitation SET created_at = DATE_SUB(NOW(), INTERVAL 10 MINUTE) WHERE id = ?',
            [$invitationId],
        );
    }

    /** Admin bez členství — jen příznak u účtu. */
    private function platformAdmin(): Identity
    {
        $email  = 'spravce@pinaprosek.eu';
        $userId = $this->makeUser($email);
        $this->db->run('UPDATE `user` SET is_platform_admin = 1 WHERE id = ?', [$userId]);

        return new Identity($userId, $email, $email, true, []);
    }
}
