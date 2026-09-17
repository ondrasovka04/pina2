<?php

declare(strict_types=1);

namespace Pina\Auth;

use Firebase\JWT\JWT;
use Firebase\JWT\Key;
use Pina\Http\ApiException;
use Pina\Support\Config;
use Pina\Support\Database;
use Throwable;

/**
 * Access token (JWT, 15 min) a refresh token (32 bajtů, 30 dní, HttpOnly).
 * Zneplatnění přes `tokens_valid_from` razítko (role, heslo, logout všude).
 */
final class TokenService
{
    private const ALGORITHM = 'HS256';

    public function __construct(private readonly Database $db)
    {
    }

    /**
     * @return array{accessToken:string,refreshToken:string,expiresIn:int}
     */
    public function issue(int $userId): array
    {
        $identity = $this->loadIdentity($userId);
        $ttl      = Config::int('JWT_ACCESS_TTL', 900);
        $now      = time();

        $payload = $identity->toArray();
        $payload = [
            'sub'           => $payload['id'],
            'email'         => $payload['email'],
            'name'          => $payload['name'],
            'platformAdmin' => $payload['platformAdmin'],
            'memberships'   => $payload['memberships'],
            'iat'           => $now,
            'exp'           => $now + $ttl,
        ];

        return [
            'accessToken'  => JWT::encode($payload, Config::get('JWT_SECRET'), self::ALGORITHM),
            'refreshToken' => $this->createRefreshToken($userId),
            'expiresIn'    => $ttl,
        ];
    }

    /** Ověří access token a vrátí identitu volajícího. */
    public function verify(string $token): Identity
    {
        try {
            // JWT::decode vrací stdClass — převést na pole kvůli vnořeným strukturám.
            $object  = JWT::decode($token, new Key(Config::get('JWT_SECRET'), self::ALGORITHM));
            $decoded = json_decode((string) json_encode($object), true);
        } catch (Throwable) {
            throw ApiException::unauthenticated();
        }

        if (!is_array($decoded)) {
            throw ApiException::unauthenticated();
        }

        $userId   = (int) ($decoded['sub'] ?? 0);
        $issuedAt = (int) ($decoded['iat'] ?? 0);

        $user = $this->db->first(
            'SELECT UNIX_TIMESTAMP(tokens_valid_from) AS valid_from, is_platform_admin FROM `user` WHERE id = ?',
            [$userId],
        );

        if ($user === null) {
            throw ApiException::unauthenticated();
        }

        // Token vydaný před zneplatnění razítka je neplatný, i když není expirovaný.
        if ($issuedAt < (int) $user['valid_from']) {
            throw ApiException::unauthenticated('Vaše oprávnění se změnila, přihlaste se prosím znovu.');
        }

        $decoded['platformAdmin'] = (bool) $user['is_platform_admin'];

        return Identity::fromTokenPayload($decoded);
    }

    public function forSupport(Identity $identity, int $teamId): Identity
    {
        if (!$identity->isPlatformAdmin || !(bool) $this->db->value('SELECT is_platform_admin FROM `user` WHERE id = ?', [$identity->userId])) {
            throw ApiException::forbidden('Režim podpory patří správci platformy.');
        }

        if ($this->db->value('SELECT id FROM team WHERE id = ?', [$teamId]) === null) {
            throw ApiException::notFound();
        }

        return $identity->withSupportTeam($teamId);
    }

    /**
     * Refresh token → nový pár (rotace, starý se zneplatní).
     * Dvojité použití = detekce kopírování → všechny relace zneplatní.
     *
     * @return array{accessToken:string,refreshToken:string,expiresIn:int}
     */
    public function refresh(string $refreshToken): array
    {
        $hash = $this->hash($refreshToken);

        $row = $this->db->first(
            'SELECT id, user_id, expires_at, revoked_at FROM refresh_token WHERE token_hash = ?',
            [$hash],
        );

        if ($row === null) {
            throw ApiException::unauthenticated();
        }

        $userId = (int) $row['user_id'];

        if ($row['revoked_at'] !== null) {
            $this->revokeAllForUser($userId);

            throw ApiException::unauthenticated('Relace byla ukončena z bezpečnostních důvodů.');
        }

        if (strtotime((string) $row['expires_at']) < time()) {
            throw ApiException::unauthenticated();
        }

        $this->db->run('UPDATE refresh_token SET revoked_at = NOW() WHERE id = ?', [$row['id']]);

        return $this->issue($userId);
    }

    public function revoke(string $refreshToken): void
    {
        $this->db->run(
            'UPDATE refresh_token SET revoked_at = NOW() WHERE token_hash = ? AND revoked_at IS NULL',
            [$this->hash($refreshToken)],
        );
    }

    public function revokeAllForUser(int $userId): void
    {
        $this->db->run(
            'UPDATE refresh_token SET revoked_at = NOW() WHERE user_id = ? AND revoked_at IS NULL',
            [$userId],
        );
    }

    /** Zneplatní všechny access tokeny: role, heslo, logout všude. */
    public function invalidateAccessTokens(int $userId): void
    {
        $this->db->run('UPDATE `user` SET tokens_valid_from = NOW() WHERE id = ?', [$userId]);
    }

    /** Role se změnila — zneplatnit všechny tokeny okamžitě. */
    public function onRoleChanged(int $userId): void
    {
        $this->invalidateAccessTokens($userId);
    }

    private function createRefreshToken(int $userId): string
    {
        $token = bin2hex(random_bytes(32));

        $this->db->run(
            'INSERT INTO refresh_token (user_id, token_hash, expires_at)
             VALUES (?, ?, DATE_ADD(NOW(), INTERVAL ? SECOND))',
            [$userId, $this->hash($token), Config::int('JWT_REFRESH_TTL', 2592000)],
        );

        return $token;
    }

    private function loadIdentity(int $userId): Identity
    {
        $user = $this->db->first(
            'SELECT id, email, display_name, is_platform_admin FROM `user` WHERE id = ?',
            [$userId],
        );

        if ($user === null) {
            throw ApiException::unauthenticated();
        }

        $roles = [];
        $rows  = $this->db->all(
            "SELECT team_id, role FROM membership WHERE user_id = ? AND status <> 'left'",
            [$userId],
        );
        foreach ($rows as $row) {
            $role = Role::tryFrom((string) $row['role']);
            if ($role instanceof Role) {
                $roles[(int) $row['team_id']] = $role;
            }
        }

        return new Identity(
            userId:          (int) $user['id'],
            email:           (string) $user['email'],
            displayName:     (string) $user['display_name'],
            isPlatformAdmin: (bool) $user['is_platform_admin'],
            rolesByTeam:     $roles,
        );
    }

    /** Otisk v DB — únik tabulky sám relace neprozradí. */
    private function hash(string $token): string
    {
        return hash('sha256', $token);
    }
}
