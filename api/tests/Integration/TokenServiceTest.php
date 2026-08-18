<?php

declare(strict_types=1);

namespace Pina\Tests\Integration;

use Pina\Auth\Role;
use Pina\Auth\TokenService;
use Pina\Http\ApiException;

final class TokenServiceTest extends DatabaseTestCase
{
    private TokenService $tokens;
    private int $userId;
    private int $teamId;

    protected function setUp(): void
    {
        parent::setUp();

        $this->tokens = new TokenService($this->db);

        [, $this->teamId] = $this->makeTeam('sk-prosek', 'Prosek - muži');
        $this->userId     = $this->makeUser('hrac@prosek.cz');
        $this->makeMembership($this->userId, $this->teamId, 'player');
    }

    public function testIssuedTokenCarriesRoles(): void
    {
        $pair     = $this->tokens->issue($this->userId);
        $identity = $this->tokens->verify($pair['accessToken']);

        self::assertSame($this->userId, $identity->userId);
        self::assertSame(Role::Player, $identity->roleInTeam($this->teamId));
        self::assertSame(900, $pair['expiresIn']);
    }

    public function testGarbageTokenIsRejected(): void
    {
        $this->expectException(ApiException::class);
        $this->tokens->verify('rozhodne.neni.jwt');
    }

    public function testRoleChangeInvalidatesExistingTokens(): void
    {
        $pair = $this->tokens->issue($this->userId);
        self::assertSame($this->userId, $this->tokens->verify($pair['accessToken'])->userId);

        // Tokeny nesou razítko v sekundách, proto se posune o vteřinu dopředu —
        // jinak by token vydaný ve stejné sekundě prošel.
        $this->db->run(
            'UPDATE `user` SET tokens_valid_from = DATE_ADD(NOW(), INTERVAL 1 SECOND) WHERE id = ?',
            [$this->userId],
        );

        try {
            $this->tokens->verify($pair['accessToken']);
            self::fail('token vydaný před změnou práv musí být odmítnut');
        } catch (ApiException $e) {
            self::assertSame(401, $e->status);
        }
    }

    public function testRefreshRotatesToken(): void
    {
        $first  = $this->tokens->issue($this->userId);
        $second = $this->tokens->refresh($first['refreshToken']);

        self::assertNotSame($first['refreshToken'], $second['refreshToken'], 'refresh token se musí měnit');
        self::assertSame($this->userId, $this->tokens->verify($second['accessToken'])->userId);
    }

    public function testReusedRefreshTokenKillsAllSessions(): void
    {
        $first  = $this->tokens->issue($this->userId);
        $second = $this->tokens->refresh($first['refreshToken']);

        // Útočník zkusí použít token, který už byl vyměněn.
        try {
            $this->tokens->refresh($first['refreshToken']);
            self::fail('opakované použití refresh tokenu musí selhat');
        } catch (ApiException $e) {
            self::assertSame(401, $e->status);
        }

        // Následkem se ruší i relace legitimního uživatele — nevíme, kdo je kdo.
        try {
            $this->tokens->refresh($second['refreshToken']);
            self::fail('po odhalení krádeže musí padnout všechny relace');
        } catch (ApiException $e) {
            self::assertSame(401, $e->status);
        }
    }

    public function testLogoutRevokesRefreshToken(): void
    {
        $pair = $this->tokens->issue($this->userId);
        $this->tokens->revoke($pair['refreshToken']);

        $this->expectException(ApiException::class);
        $this->tokens->refresh($pair['refreshToken']);
    }

    public function testRefreshTokenIsStoredOnlyAsHash(): void
    {
        $pair = $this->tokens->issue($this->userId);

        $stored = $this->db->value('SELECT token_hash FROM refresh_token WHERE user_id = ?', [$this->userId]);

        self::assertNotSame($pair['refreshToken'], $stored);
        self::assertSame(hash('sha256', $pair['refreshToken']), $stored);
    }
}
