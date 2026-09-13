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

    /**
     * Náhled pozvánky, ještě než ji někdo přijme — appka podle toho pozná, jestli
     * se má ptát na heslo a jméno, nebo je pozvaný hráč v jiném klubu má už dávno.
     *
     * @return array{email:string,teamName:string,role:string,name:string|null,hasPassword:bool}
     */
    public function previewInvitation(string $token): array
    {
        $invitation = $this->loadValidInvitation($token);

        $existing = $this->db->first(
            'SELECT display_name, password_hash FROM `user` WHERE email = ?',
            [$invitation['email']],
        );

        return [
            'email'       => $invitation['email'],
            'teamName'    => (string) $this->db->value('SELECT name FROM team WHERE id = ?', [$invitation['team_id']]),
            'role'        => $invitation['role'],
            'name'        => $existing === null ? null : (string) $existing['display_name'],
            'hasPassword' => $existing !== null && $existing['password_hash'] !== null,
        ];
    }

    /**
     * Přijetí pozvánky: nastavení hesla a aktivace členství. Heslo a jméno jsou
     * povinné, jen když si je nemá odkud vzít — hráč v jiném klubu je nastavil
     * dřív a tady se jen přidá další členství.
     */
    public function acceptInvitation(string $token, ?string $password, ?string $displayName): int
    {
        $invitation = $this->loadValidInvitation($token);
        $email      = $invitation['email'];

        $existing = $this->db->first(
            'SELECT id, password_hash FROM `user` WHERE email = ?',
            [$email],
        );

        $needsPassword = $existing === null || $existing['password_hash'] === null;

        if ($needsPassword) {
            if ($password === null || $password === '') {
                throw ApiException::validation('Vyplňte heslo.', ['field' => 'password']);
            }

            $this->passwords->assertStrong($password);
        }

        if ($existing === null && ($displayName === null || $displayName === '')) {
            throw ApiException::validation('Vyplňte jméno.', ['field' => 'name']);
        }

        return $this->db->transaction(function () use (
            $displayName,
            $email,
            $existing,
            $invitation,
            $needsPassword,
            $password,
        ): int {
            if ($existing === null) {
                $this->db->run(
                    'INSERT INTO `user` (email, display_name, password_hash, email_verified_at)
                     VALUES (?, ?, ?, NOW())',
                    [$email, $displayName, $this->passwords->hash((string) $password)],
                );
                $userId = $this->db->lastInsertId();
            } else {
                $userId = (int) $existing['id'];

                if ($needsPassword) {
                    $this->db->run(
                        'UPDATE `user` SET password_hash = ?, email_verified_at = COALESCE(email_verified_at, NOW())
                          WHERE id = ?',
                        [$this->passwords->hash((string) $password), $userId],
                    );
                }
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

            return $userId;
        });
    }

    /**
     * Platná, dosud nepřijatá pozvánka podle tokenu — sdílené jádro pro náhled
     * i samotné přijetí, ať se validace expirace na dvou místech nerozejde.
     *
     * @return array{id:int,team_id:int,email:string,role:string}
     */
    private function loadValidInvitation(string $token): array
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

        return [
            'id'      => (int) $invitation['id'],
            'team_id' => (int) $invitation['team_id'],
            'email'   => (string) $invitation['email'],
            'role'    => (string) $invitation['role'],
        ];
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
