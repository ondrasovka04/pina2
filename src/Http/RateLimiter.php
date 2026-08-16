<?php

declare(strict_types=1);

namespace Pina\Http;

use Pina\Support\Database;

/**
 * Omezení počtu pokusů o přihlášení. Bez něj je login na sdíleném hostingu
 * volně zkoušitelný hrubou silou — stará verze proti tomu neměla nic.
 *
 * Počítá se zvlášť podle e-mailu a podle IP: útočník zkoušející hesla k jednomu
 * účtu narazí na první limit, útočník zkoušející jedno heslo na mnoho účtů
 * (password spraying) na druhý.
 */
final class RateLimiter
{
    private const MAX_PER_EMAIL = 5;
    private const MAX_PER_IP    = 20;
    private const WINDOW_MIN    = 15;

    public function __construct(private readonly Database $db)
    {
    }

    public function assertCanAttemptLogin(string $email, ?string $ip): void
    {
        $byEmail = (int) $this->db->value(
            'SELECT COUNT(*) FROM login_attempt
              WHERE email = ? AND succeeded = 0 AND created_at > DATE_SUB(NOW(), INTERVAL ? MINUTE)',
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
              WHERE ip = ? AND succeeded = 0 AND created_at > DATE_SUB(NOW(), INTERVAL ? MINUTE)',
            [$this->packIp($ip), self::WINDOW_MIN],
        );

        if ($byIp >= self::MAX_PER_IP) {
            throw ApiException::tooManyRequests(
                'Příliš mnoho pokusů o přihlášení z této adresy.',
                self::WINDOW_MIN * 60,
            );
        }
    }

    public function record(string $email, ?string $ip, bool $succeeded): void
    {
        $this->db->run(
            'INSERT INTO login_attempt (email, ip, succeeded) VALUES (?, ?, ?)',
            [$email, $ip === null ? null : $this->packIp($ip), $succeeded ? 1 : 0],
        );
    }

    /** Úspěšné přihlášení maže historii neúspěchů, aby limit nedoháněl majitele účtu. */
    public function clear(string $email): void
    {
        $this->db->run('DELETE FROM login_attempt WHERE email = ? AND succeeded = 0', [$email]);
    }

    private function packIp(string $ip): ?string
    {
        $packed = @inet_pton($ip);

        return $packed === false ? null : $packed;
    }
}
