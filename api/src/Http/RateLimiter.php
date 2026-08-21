<?php

declare(strict_types=1);

namespace Pina\Http;

use Pina\Support\Database;

/**
 * Rate limiting na login: per-email a per-IP (brání bruteforce i spraying).
 *
 * Ukládají se **jen nepovedené** pokusy. Úspěšný do žádného počítání nevstupuje,
 * takže by z něj byl jen trvalý seznam „kdo se odkud a kdy přihlásil", který
 * nikdo nečte. Provozní stopa proto zachycuje citlivé změny peněz a
 * oprávnění, ne přihlašování a IP adresy.
 */
final class RateLimiter
{
    private const MAX_PER_EMAIL = 5;
    private const MAX_PER_IP    = 20;
    private const WINDOW_MIN    = 15;

    /** Po jak dlouhé době ztrácí pokus smysl i jako stopa. Delší zdržení nikoho nezajímá. */
    private const KEEP_HOURS = 24;

    public function __construct(private readonly Database $db)
    {
    }

    public function assertCanAttemptLogin(string $email, ?string $ip): void
    {
        $byEmail = (int) $this->db->value(
            'SELECT COUNT(*) FROM login_attempt
              WHERE email = ? AND created_at > DATE_SUB(NOW(), INTERVAL ? MINUTE)',
            [$email, self::WINDOW_MIN],
        );

        if ($byEmail >= self::MAX_PER_EMAIL) {
            throw ApiException::tooManyRequests(
                'Příliš mnoho pokusů o přihlášení. Zkuste to za pár minut znovu.',
                self::WINDOW_MIN * 60,
            );
        }

        if ($ip === null) {
            return;
        }

        $byIp = (int) $this->db->value(
            'SELECT COUNT(*) FROM login_attempt
              WHERE ip = ? AND created_at > DATE_SUB(NOW(), INTERVAL ? MINUTE)',
            [$this->packIp($ip), self::WINDOW_MIN],
        );

        if ($byIp >= self::MAX_PER_IP) {
            throw ApiException::tooManyRequests(
                'Příliš mnoho pokusů o přihlášení z této adresy.',
                self::WINDOW_MIN * 60,
            );
        }
    }

    public function recordFailure(string $email, ?string $ip): void
    {
        $this->db->run(
            'INSERT INTO login_attempt (email, ip) VALUES (?, ?)',
            [$email, $ip === null ? null : $this->packIp($ip)],
        );

        // Úklid při zápisu, ne plánovanou úlohou: tabulka se plní jen při selhání,
        // takže je to pár řádků za den a nemá pro co ležet dál.
        $this->db->run('DELETE FROM login_attempt WHERE created_at < DATE_SUB(NOW(), INTERVAL ? HOUR)', [self::KEEP_HOURS]);
    }

    /** Úspěšné přihlášení — vymazat selhání (aby limit nenapadl majitele). */
    public function clear(string $email): void
    {
        $this->db->run('DELETE FROM login_attempt WHERE email = ?', [$email]);
    }

    private function packIp(string $ip): ?string
    {
        $packed = @inet_pton($ip);

        return $packed === false ? null : $packed;
    }
}
