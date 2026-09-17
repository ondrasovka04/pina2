<?php

declare(strict_types=1);

namespace Pina\Tests\Integration;

use Pina\Auth\Identity;
use Pina\Auth\Role;
use Pina\Auth\TeamScope;
use Pina\Auth\TokenService;
use Pina\Http\ApiException;
use Pina\Http\Kernel;
use Pina\Http\Request;
use Pina\Http\Response;
use Pina\Http\Router;
use Pina\Mail\InvitationMail;
use Pina\Service\AuditLog;
use Pina\Service\EventService;
use Pina\Service\FinanceService;
use Pina\Service\FinancialAccess;
use Pina\Service\OffenceService;
use Pina\Service\SeasonService;
use Pina\Service\TeamService;
use Pina\Support\Logger;
use Pina\Tests\Support\FakeMailer;

final class SupportModeTest extends DatabaseTestCase
{
    private TokenService $tokens;
    private TeamScope $scope;
    private TeamService $teams;
    private int $teamId;
    private int $otherTeamId;
    private int $seasonId;
    private int $platformId;
    private int $playerId;
    private int $memberId;
    private Identity $platform;
    private string|false $previousAppUrl;

    protected function setUp(): void
    {
        parent::setUp();
        $this->previousAppUrl = getenv('APP_URL');
        putenv('APP_URL=https://example.test');
        $this->tokens          = new TokenService($this->db);
        $this->scope           = new TeamScope($this->db);
        $this->teams           = new TeamService($this->db, $this->scope, $this->tokens, new InvitationMail(new FakeMailer(), 'https://example.test'));
        [, $this->teamId]      = $this->makeTeam('support', 'Podporované družstvo');
        [, $this->otherTeamId] = $this->makeTeam('other', 'Jiné družstvo');
        $this->seasonId        = $this->makeSeason($this->teamId, '26/27');
        $this->platformId      = $this->makeUser('support@example.test');
        $this->db->run('UPDATE `user` SET is_platform_admin = 1 WHERE id = ?', [$this->platformId]);
        $this->platform = new Identity($this->platformId, 'support@example.test', 'Podpora', true, []);
        $this->playerId = $this->makeUser('player@example.test');
        $this->memberId = $this->makeMembership($this->playerId, $this->teamId, 'player');
        $this->makeRoster($this->seasonId, [$this->memberId]);
        $this->db->run('UPDATE `user` SET phone = ? WHERE id = ?', ['+420777123456', $this->playerId]);
    }

    public function testSupportReadsAndSetsUpTeamWithoutJoiningIt(): void
    {
        $context = $this->teams->supportTeam($this->platform, $this->teamId);
        self::assertNull($context['membershipId']);
        self::assertSame('admin', $context['role']);
        self::assertSame([], $this->teams->myTeams($this->platform));
        $support = $this->tokens->forSupport($this->platform, $this->teamId);
        self::assertCount(1, (new SeasonService($this->db, $this->scope))->forTeam($support, $this->teamId));
        self::assertNull((new FinancialAccess($this->db))->restrictedToMembership($support, $this->teamId));
        self::assertSame('+420777123456', $this->teams->members($support, $this->teamId)[0]['phone']);

        $this->teams->updateMembership($support, $this->memberId, ['role' => Role::Treasurer]);
        $audit = (new AuditLog($this->db, $this->scope))->forTeam($support, $this->teamId, 25, 0);
        self::assertNotNull($audit['items'][0]['actor']);
        self::assertSame($this->platformId, $audit['items'][0]['actor']['id']);
        self::assertSame('role_changed', $audit['items'][0]['action']);
        self::assertSame(0, (int) $this->db->value('SELECT COUNT(*) FROM membership WHERE user_id = ?', [$this->platformId]));
        self::assertSame(1, (int) $this->db->value('SELECT COUNT(*) FROM roster_entry WHERE season_id = ?', [$this->seasonId]));
    }

    public function testSupportHasNoOwnAttendanceOrRsvpWithoutMembership(): void
    {
        $support = $this->tokens->forSupport($this->platform, $this->teamId);
        $this->db->run("INSERT INTO event (season_id, type, title, starts_at, status) VALUES (?, 'training', 'Trénink', '2099-09-15 19:00:00', 'planned')", [$this->seasonId]);
        $eventId = $this->db->lastInsertId();
        $events  = new EventService($this->db, $this->scope);
        $detail  = $events->detail($support, $eventId);
        self::assertNull($detail['event']['me']);
        self::assertTrue($detail['canSeeAttendance']);
        self::assertCount(1, $detail['participants']);
        $this->expectException(ApiException::class);
        $events->saveRsvp($support, $eventId, ['rsvp' => 'yes', 'transport' => 'none', 'note' => null, 'carSeats' => null]);
    }

    public function testExistingMembershipAndRoleArePreserved(): void
    {
        $memberId = $this->makeMembership($this->platformId, $this->teamId, 'player');
        $context  = $this->teams->supportTeam($this->platform, $this->teamId);
        self::assertSame($memberId, $context['membershipId']);
        self::assertSame('admin', $context['role']);
        self::assertSame('player', $this->db->value('SELECT role FROM membership WHERE id = ?', [$memberId]));
        self::assertSame('player', $this->teams->myTeams($this->platform)[0]['role']);
    }

    public function testPlatformRoleAloneCannotReadOrEditTeam(): void
    {
        $token = $this->tokens->issue($this->platformId)['accessToken'];
        self::assertSame(404, $this->request($token, null, $this->teamId)->status);
        $own = $this->makeMembership($this->platformId, $this->teamId, 'player');
        self::assertSame(403, $this->request($token, null, $this->teamId)->status);
        self::assertSame($this->teamId, $this->scope->season($this->platform, $this->seasonId, Role::Player));
        self::assertSame($this->teamId, $this->scope->ownMembershipOr($this->platform, $own, Role::Treasurer));
        try {
            $this->scope->ownMembershipOr($this->platform, $this->memberId, Role::Treasurer);
            self::fail('Správce s rolí hráče nesmí upravovat spoluhráče.');
        } catch (ApiException $error) {
            self::assertSame(403, $error->status);
        }
        $support = $this->tokens->forSupport($this->platform, $this->teamId);
        self::assertSame($this->teamId, $this->scope->ownMembershipOr($support, $this->memberId, Role::Treasurer));
    }

    public function testSupportIsRequiredForClubAgendaButNotTeamCreation(): void
    {
        $club = (int) $this->db->value('SELECT club_id FROM team WHERE id = ?', [$this->teamId]);
        try {
            $this->scope->club($this->platform, $club, Role::Treasurer);
            self::fail('Samotná platformní role nesmí otevřít agendu klubu.');
        } catch (ApiException $error) {
            self::assertSame(404, $error->status);
        }
        $support = $this->tokens->forSupport($this->platform, $this->teamId);
        $this->scope->club($support, $club, Role::Treasurer);
        $created = $this->teams->createTeam($this->platform, $club, 'Nové družstvo');
        self::assertSame('Nové družstvo', $created['name']);
        self::assertSame('admin', $this->db->value('SELECT role FROM membership WHERE user_id = ? AND team_id = ?', [$this->platformId, $created['id']]));
        self::assertSame(0, $this->db->value('SELECT COUNT(*) FROM membership WHERE user_id = ? AND team_id = ?', [$this->platformId, $this->teamId]));
    }

    public function testHeaderCannotGrantSupportToOrdinaryUsers(): void
    {
        $token = $this->tokens->issue($this->playerId)['accessToken'];
        self::assertSame(403, $this->request($token, (string) $this->teamId, $this->teamId)->status);
    }

    public function testHeaderIsLimitedToChosenTeamAndValidated(): void
    {
        $token = $this->tokens->issue($this->platformId)['accessToken'];
        self::assertSame(200, $this->request($token, (string) $this->teamId, $this->teamId)->status);
        self::assertSame(404, $this->request($token, (string) $this->teamId, $this->otherTeamId)->status);
        self::assertSame(404, $this->request($token, '999999', $this->teamId)->status);
        self::assertSame(400, $this->request($token, 'abc', $this->teamId)->status);
    }

    public function testSupportCanWriteOffencesAndPaymentsWithoutBecomingAPlayer(): void
    {
        $support = $this->tokens->forSupport($this->platform, $this->teamId);
        $this->db->run('INSERT INTO offence_type (season_id, name, amount_czk) VALUES (?, ?, ?)', [$this->seasonId, 'Pozdní příchod', 20]);
        $typeId   = $this->db->lastInsertId();
        $offences = new OffenceService($this->db, $this->scope);
        $batch    = $offences->createBatch($support, $this->seasonId, [
            'clientUuid' => 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',
            'occurredOn' => '2026-09-16',
            'eventId'    => null,
            'title'      => 'Trénink',
            'note'       => null,
            'items'      => [['membershipId' => $this->memberId, 'offenceTypeId' => $typeId, 'count' => 2, 'note' => null, 'expectedAmountCzk' => 20]],
        ]);
        self::assertSame(40, $batch['totalCzk']);
        self::assertNotNull($batch['batch']['createdBy']);
        self::assertSame($this->platformId, $batch['batch']['createdBy']['id']);

        $finance = new FinanceService($this->db, $this->scope);
        $finance->createPayment($support, $this->seasonId, [
            'membershipId' => $this->memberId,
            'amountCzk'    => 10,
            'paidOn'       => '2026-09-16',
            'method'       => 'cash',
            'note'         => null,
        ]);
        $balances = $offences->balances($support, $this->seasonId);
        self::assertCount(1, $balances['members']);
        self::assertSame(30, $balances['members'][0]['balanceCzk']);
        self::assertSame($this->memberId, $balances['members'][0]['membershipId']);
        self::assertCount(1, $finance->payments($support, $this->seasonId)['items']);
        self::assertSame(0, (int) $this->db->value('SELECT COUNT(*) FROM membership WHERE user_id = ?', [$this->platformId]));
    }

    public function testSupportCanConfigureTeamAndCreateSeason(): void
    {
        $support = $this->tokens->forSupport($this->platform, $this->teamId);
        $renamed = $this->teams->update($support, $this->teamId, ['name' => 'Nový název']);
        self::assertSame('Nový název', $renamed['name']);
        $seasons = new SeasonService($this->db, $this->scope);
        $created = $seasons->create($support, $this->teamId, '27/28', '2027-09-01', '2028-06-30');
        self::assertSame('27/28', $created['name']);
        self::assertCount(2, $seasons->forTeam($support, $this->teamId));
        self::assertSame(0, (int) $this->db->value('SELECT COUNT(*) FROM membership WHERE user_id = ?', [$this->platformId]));
    }

    public function testRevokingPlatformRoleStopsPreviouslyIssuedTokenImmediately(): void
    {
        $token = $this->tokens->issue($this->platformId)['accessToken'];
        $this->db->run('UPDATE `user` SET is_platform_admin = 0 WHERE id = ?', [$this->platformId]);
        self::assertFalse($this->tokens->verify($token)->isPlatformAdmin);
        self::assertSame(403, $this->request($token, (string) $this->teamId, $this->teamId)->status);
    }

    public function testClosedSeasonStillRejectsSupportWrites(): void
    {
        $support = $this->tokens->forSupport($this->platform, $this->teamId);
        $this->db->run('UPDATE season SET closed_at = NOW() WHERE id = ?', [$this->seasonId]);
        try {
            $this->scope->writableSeason($support, $this->seasonId, Role::Admin);
            self::fail('Uzavřená sezóna musí zůstat uzavřená.');
        } catch (ApiException $error) {
            self::assertSame('SEASON_CLOSED', $error->errorCode);
        }
    }

    protected function tearDown(): void
    {
        putenv($this->previousAppUrl === false ? 'APP_URL' : 'APP_URL=' . $this->previousAppUrl);
        parent::tearDown();
    }

    private function request(string $token, ?string $supportTeam, int $teamId): Response
    {
        $router = new Router();
        $router->get('/teams/{team}', function (Request $request): Response {
            $this->scope->team($request->identity(), $request->routeId('team'), Role::Admin);
            return Response::ok(['ok' => true]);
        });
        $kernel = new Kernel($router, $this->tokens, new Logger(sys_get_temp_dir()));
        return $kernel->handle(new Request('GET', '/teams/' . $teamId, [], [], ['authorization' => 'Bearer ' . $token, ...($supportTeam === null ? [] : ['x-support-team' => $supportTeam])], '127.0.0.1'));
    }
}
