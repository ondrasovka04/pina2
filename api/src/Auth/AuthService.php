<?php

declare(strict_types=1);

namespace Pina\Auth;

use Pina\Http\ApiException;
use Pina\Http\RateLimiter;
use Pina\Support\Config;
use Pina\Support\Database;
use Pina\Support\PaymentReference;

/** Přihlášení a správa pozvánek. */
final class AuthService
{
    public function __construct(
        private readonly Database $db,
        private readonly TokenService $tokens,
        private readonly PasswordService $passwords,
        private readonly RateLimiter $limiter,
    ) {
    }

    /**
     * @return array{accessToken:string,refreshToken:string,expiresIn:int,user:array<string,mixed>}
     */
    public function login(string $email, string $password, ?string $ip): array
    {
        $email = mb_strtolower(trim($email));

        $this->limiter->assertCanAttemptLogin($email, $ip);

        $user = $this->db->first(
            'SELECT id, password_hash FROM `user` WHERE email = ?',
            [$email],
        );

        $hash  = $user === null || $user['password_hash'] === null ? null : (string) $user['password_hash'];
        $valid = $this->passwords->verify($password, $hash);

        if (!$valid || $user === null) {
            $this->limiter->recordFailure($email, $ip);

            // Stejná hláška pro neexistující účet i špatné heslo (brání enumeraci).
            throw new ApiException(401, 'INVALID_CREDENTIALS', 'Nesprávný e-mail nebo heslo.');
        }

        $userId = (int) $user['id'];

        $this->limiter->clear($email);

        if ($hash !== null && $this->passwords->needsRehash($hash)) {
            $this->db->run(
                'UPDATE `user` SET password_hash = ? WHERE id = ?',
                [$this->passwords->hash($password), $userId],
            );
        }

        $pair = $this->tokens->issue($userId);

        return [...$pair, 'user' => $this->userPayload($userId)];
    }

    /** Přijetí pozvánky: nastavení hesla a aktivace členství. */
    public function acceptInvitation(string $token, string $password, string $displayName): int
    {
        $hash = hash('sha256', $token);

        $invitation = $this->db->first(
            'SELECT id, team_id, email, role, expires_at, accepted_at
               FROM invitation WHERE token_hash = ?',
            [$hash],
        );

        if ($invitation === null || $invitation['accepted_at'] !== null) {
            throw ApiException::validation('Pozvánka je neplatná nebo už byla použita.');
        }

        if (strtotime((string) $invitation['expires_at']) < time()) {
            throw ApiException::validation('Platnost pozvánky vypršela, požádejte o novou.');
        }

        $this->passwords->assertStrong($password);

        return $this->db->transaction(function () use ($invitation, $password, $displayName): int {
            $email  = (string) $invitation['email'];
            $userId = $this->db->value('SELECT id FROM `user` WHERE email = ?', [$email]);

            if ($userId === null) {
                $this->db->run(
                    'INSERT INTO `user` (email, display_name, password_hash, email_verified_at)
                     VALUES (?, ?, ?, NOW())',
                    [$email, $displayName, $this->passwords->hash($password)],
                );
                $userId = $this->db->lastInsertId();
            } else {
                // Hráč v několika klubech — heslo jen pokud nemá.
                $userId = (int) $userId;
                $this->db->run(
                    'UPDATE `user`
                        SET password_hash    = COALESCE(password_hash, ?),
                            email_verified_at = COALESCE(email_verified_at, NOW())
                      WHERE id = ?',
                    [$this->passwords->hash($password), $userId],
                );
            }

            $this->db->run(
                'INSERT INTO membership (user_id, team_id, role, payment_reference)
                 VALUES (?, ?, ?, ?)
                 ON DUPLICATE KEY UPDATE role = VALUES(role), status = \'active\'',
                [
                    $userId,
                    $invitation['team_id'],
                    $invitation['role'],
                    PaymentReference::for((int) $invitation['team_id'], (int) $userId),
                ],
            );

            $this->db->run('UPDATE invitation SET accepted_at = NOW() WHERE id = ?', [$invitation['id']]);

            return (int) $userId;
        });
    }

    public function changePassword(int $userId, string $current, string $new): void
    {
        $hash = $this->db->value('SELECT password_hash FROM `user` WHERE id = ?', [$userId]);

        if (!$this->passwords->verify($current, $hash === null ? null : (string) $hash)) {
            throw ApiException::validation('Současné heslo nesouhlasí.', ['field' => 'currentPassword']);
        }

        $this->db->run(
            'UPDATE `user` SET password_hash = ? WHERE id = ?',
            [$this->passwords->hash($new), $userId],
        );

        // Změna hesla zneplatní všechny relace na všech zařízeních.
        $this->tokens->revokeAllForUser($userId);
        $this->tokens->invalidateAccessTokens($userId);
    }

    /** @return array<string,mixed> */
    public function userPayload(int $userId): array
    {
        $user = $this->db->first(
            'SELECT id, email, display_name, avatar_url, is_platform_admin FROM `user` WHERE id = ?',
            [$userId],
        );

        if ($user === null) {
            throw ApiException::unauthenticated();
        }

        $memberships = $this->db->all(
            "SELECT m.id, m.team_id, m.role, m.payment_reference,
                    t.name AS team_name, t.club_id, c.name AS club_name
               FROM membership m
               JOIN team t ON t.id = m.team_id
               JOIN club c ON c.id = t.club_id
              WHERE m.user_id = ? AND m.status <> 'left'
              ORDER BY c.name, t.name",
            [$userId],
        );

        return [
            'id'            => (int) $user['id'],
            'email'         => $user['email'],
            'name'          => $user['display_name'],
            'avatarUrl'     => $user['avatar_url'] === null ? null : (string) $user['avatar_url'],
            'platformAdmin' => (bool) $user['is_platform_admin'],
            // Údaj o nasazení, ne o uživateli — musí být stále dostupný.
            'mailEnabled' => Config::bool('MAIL_ENABLED') && Config::get('MAIL_PASSWORD', '') !== '',
            'memberships' => array_map(static fn (array $m): array => [
                'id'               => (int) $m['id'],
                'teamId'           => (int) $m['team_id'],
                'teamName'         => $m['team_name'],
                'clubId'           => (int) $m['club_id'],
                'clubName'         => $m['club_name'],
                'role'             => $m['role'],
                'paymentReference' => $m['payment_reference'],
            ], $memberships),
        ];
    }
}
