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
 * Vydávání a ověřování tokenů.
 *
 *   access token  — JWT, 15 minut, klient ho drží v paměti (ne v localStorage kvůli XSS)
 *   refresh token — 32 náhodných bajtů, 30 dní, HttpOnly cookie; v DB jen jako otisk
 *
 * JWT je ze své podstaty nezneplatnitelný — server si vydané tokeny nepamatuje,
 * jen ověřuje podpis. Proto má uživatel razítko `tokens_valid_from`: posunutím
 * na „teď“ se odmítnou všechny dříve vydané tokeny. Používá se při změně role,
 * změně hesla a při odhlášení ze všech zařízení.
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
    public function issue(int $userId, ?string $userAgent, ?string $ip): array
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
            'refreshToken' => $this->createRefreshToken($userId, $userAgent, $ip),
            'expiresIn'    => $ttl,
        ];
    }

    /** Ověří access token a vrátí identitu volajícího. */
    public function verify(string $token): Identity
    {
        try {
            // JWT::decode vrací stdClass i u vnořených struktur (memberships),
            // proto se převádí na pole rekurzivně.
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

        $validFrom = $this->db->value(
            'SELECT UNIX_TIMESTAMP(tokens_valid_from) FROM `user` WHERE id = ?',
            [$userId],
        );

        if ($validFrom === null) {
            throw ApiException::unauthenticated();
        }

        // Token vydaný před posunutím razítka (změna role, změna hesla, odhlášení
        // ze všech zařízení) je neplatný, i když má správný podpis a nevypršel.
        if ($issuedAt < (int) $validFrom) {
            throw ApiException::unauthenticated('Vaše oprávnění se změnila, přihlaste se prosím znovu.');
        }

        return Identity::fromTokenPayload($decoded);
    }

    /**
     * Vymění refresh token za nový pár. Starý se okamžitě zneplatní (rotace).
     *
     * Když se objeví už použitý token, znamená to, že ho někdo zkopíroval —
     * zneplatní se proto všechny relace daného uživatele.
     *
     * @return array{accessToken:string,refreshToken:string,expiresIn:int}
     */
    public function refresh(string $refreshToken, ?string $userAgent, ?string $ip): array
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

        return $this->issue($userId, $userAgent, $ip);
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

    /**
     * Zneplatní všechny vydané access tokeny uživatele. Volá se při změně role,
     * změně hesla a odhlášení ze všech zařízení.
     */
    public function invalidateAccessTokens(int $userId): void
    {
        $this->db->run('UPDATE `user` SET tokens_valid_from = NOW() WHERE id = ?', [$userId]);
    }

    /** Změna role musí okamžitě dopadnout na už vydané tokeny. */
    public function onRoleChanged(int $userId): void
    {
        $this->invalidateAccessTokens($userId);
    }

    private function createRefreshToken(int $userId, ?string $userAgent, ?string $ip): string
    {
        $token     = bin2hex(random_bytes(32));
        $packedIp  = $ip === null ? false : @inet_pton($ip);

        $this->db->run(
            'INSERT INTO refresh_token (user_id, token_hash, expires_at, user_agent, ip)
             VALUES (?, ?, DATE_ADD(NOW(), INTERVAL ? SECOND), ?, ?)',
            [
                $userId,
                $this->hash($token),
                Config::int('JWT_REFRESH_TTL', 2592000),
                $userAgent === null ? null : mb_substr($userAgent, 0, 255),
                $packedIp === false ? null : $packedIp,
            ],
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

    /** V databázi je uložen jen otisk — únik tabulky sám o sobě relace neprozradí. */
    private function hash(string $token): string
    {
        return hash('sha256', $token);
    }
}
