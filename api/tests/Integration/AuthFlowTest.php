<?php

declare(strict_types=1);

namespace Pina\Tests\Integration;

use Pina\Auth\AuthService;
use Pina\Auth\PasswordService;
use Pina\Auth\Role;
use Pina\Auth\TokenService;
use Pina\Http\ApiException;
use Pina\Http\RateLimiter;

/** Cesta od pozvánky přes přihlášení k datům. */
final class AuthFlowTest extends DatabaseTestCase
{
    private AuthService $auth;
    private TokenService $tokens;
    private RateLimiter $limiter;
    private int $teamId;

    protected function setUp(): void
    {
        parent::setUp();

        $passwords     = new PasswordService();
        $this->tokens  = new TokenService($this->db);
        $this->limiter = new RateLimiter($this->db);
        $this->auth    = new AuthService($this->db, $this->tokens, $passwords, $this->limiter);

        [, $this->teamId] = $this->makeTeam('sk-prosek', 'Prosek - muži');
    }

    private function invite(string $email, string $role = 'player'): string
    {
        $token = bin2hex(random_bytes(16));

        $this->db->run(
            'INSERT INTO invitation (team_id, email, role, token_hash, expires_at)
             VALUES (?, ?, ?, ?, DATE_ADD(NOW(), INTERVAL 72 HOUR))',
            [$this->teamId, $email, $role, hash('sha256', $token)],
        );

        return $token;
    }

    public function testInvitationCreatesUsableAccount(): void
    {
        $token  = $this->invite('novy@prosek.cz', 'treasurer');
        $userId = $this->auth->acceptInvitation($token, 'opravdu-dlouhe-heslo', 'Nový Pínař');

        $result = $this->auth->login('novy@prosek.cz', 'opravdu-dlouhe-heslo', null, '127.0.0.1');

        self::assertSame($userId, $result['user']['id']);
        self::assertSame('treasurer', $result['user']['memberships'][0]['role']);
        self::assertNotEmpty($result['user']['memberships'][0]['paymentReference']);
    }

    public function testInvitationCannotBeUsedTwice(): void
    {
        $token = $this->invite('jednou@prosek.cz');
        $this->auth->acceptInvitation($token, 'opravdu-dlouhe-heslo', 'Jednou');

        $this->expectException(ApiException::class);
        $this->auth->acceptInvitation($token, 'jine-dlouhe-heslo', 'Podruhé');
    }

    public function testSamePersonInTwoClubsKeepsOneAccount(): void
    {
        // Jeden účet, jedno heslo, více členství.
        [, $secondTeam] = $this->makeTeam('vk-benatky', 'VK Benátky');

        $first = $this->invite('obojziv@example.cz');
        $this->auth->acceptInvitation($first, 'opravdu-dlouhe-heslo', 'Obojživelník');

        $secondToken = bin2hex(random_bytes(16));
        $this->db->run(
            'INSERT INTO invitation (team_id, email, role, token_hash, expires_at)
             VALUES (?, ?, ?, ?, DATE_ADD(NOW(), INTERVAL 72 HOUR))',
            [$secondTeam, 'obojziv@example.cz', 'player', hash('sha256', $secondToken)],
        );

        $this->auth->acceptInvitation($secondToken, 'uplne-jine-heslo', 'Obojživelník');

        $result = $this->auth->login('obojziv@example.cz', 'opravdu-dlouhe-heslo', null, null);

        self::assertCount(2, $result['user']['memberships']);
        self::assertSame(1, (int) $this->db->value('SELECT COUNT(*) FROM `user`'));
    }

    public function testWrongPasswordGivesSameErrorAsUnknownAccount(): void
    {
        $token = $this->invite('existuje@prosek.cz');
        $this->auth->acceptInvitation($token, 'opravdu-dlouhe-heslo', 'Existuje');

        $messages = [];
        foreach ([['existuje@prosek.cz', 'spatne-heslo'], ['neexistuje@prosek.cz', 'jakekoliv']] as [$email, $password]) {
            try {
                $this->auth->login($email, $password, null, null);
                self::fail('přihlášení mělo selhat');
            } catch (ApiException $e) {
                $messages[] = $e->getMessage();
                self::assertSame(401, $e->status);
            }
        }

        // Stejné hlášky — aby se nezměňoval, kdo je v systému.
        self::assertSame($messages[0], $messages[1]);
    }

    public function testShortPasswordIsRejected(): void
    {
        $token = $this->invite('kratke@prosek.cz');

        $this->expectException(ApiException::class);
        $this->auth->acceptInvitation($token, 'kratke', 'Krátké');
    }

    public function testBruteForceIsBlockedAfterFiveAttempts(): void
    {
        $token = $this->invite('obet@prosek.cz');
        $this->auth->acceptInvitation($token, 'opravdu-dlouhe-heslo', 'Oběť');

        for ($i = 0; $i < 5; $i++) {
            try {
                $this->auth->login('obet@prosek.cz', 'spatne' . $i, null, '10.0.0.1');
            } catch (ApiException) {
                // očekávaná chyba
            }
        }

        try {
            $this->auth->login('obet@prosek.cz', 'opravdu-dlouhe-heslo', null, '10.0.0.1');
            self::fail('po pěti pokusech musí přijít omezení');
        } catch (ApiException $e) {
            self::assertSame(429, $e->status);
        }
    }

    public function testPasswordChangeEndsAllSessions(): void
    {
        $token  = $this->invite('menic@prosek.cz');
        $userId = $this->auth->acceptInvitation($token, 'opravdu-dlouhe-heslo', 'Měnič');

        $session = $this->tokens->issue($userId, null, null);
        self::assertSame($userId, $this->tokens->verify($session['accessToken'])->userId);

        $this->db->run('UPDATE `user` SET tokens_valid_from = DATE_SUB(NOW(), INTERVAL 1 SECOND) WHERE id = ?', [$userId]);
        $this->auth->changePassword($userId, 'opravdu-dlouhe-heslo', 'zcela-nove-heslo-2026');

        try {
            $this->tokens->refresh($session['refreshToken'], null, null);
            self::fail('staré tokeny musí padnout');
        } catch (ApiException $e) {
            self::assertSame(401, $e->status);
        }

        $this->auth->login('menic@prosek.cz', 'zcela-nove-heslo-2026', null, null);

        $this->expectException(ApiException::class);
        $this->auth->login('menic@prosek.cz', 'opravdu-dlouhe-heslo', null, null);
    }

    public function testRoleFromInvitationLandsInToken(): void
    {
        $token  = $this->invite('admin@prosek.cz', 'admin');
        $userId = $this->auth->acceptInvitation($token, 'opravdu-dlouhe-heslo', 'Admin');

        $pair     = $this->tokens->issue($userId, null, null);
        $identity = $this->tokens->verify($pair['accessToken']);

        self::assertSame(Role::Admin, $identity->roleInTeam($this->teamId));
        self::assertTrue($identity->hasRoleInTeam($this->teamId, Role::Treasurer));
    }
}
