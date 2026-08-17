<?php

declare(strict_types=1);

namespace Pina\Tests\Integration;

use PHPUnit\Framework\Attributes\DataProvider;
use Pina\Auth\AuthService;
use Pina\Auth\PasswordService;
use Pina\Auth\TokenService;
use Pina\Http\ApiException;
use Pina\Http\RateLimiter;

/** Ověření, že prepared statements (bez emulace) opravdu hlídají vstup. */
final class SqlInjectionTest extends DatabaseTestCase
{
    /** @return list<array{string}> */
    public static function payloads(): array
    {
        return [
            ["x@y.cz' OR '1'='1"],
            ["x@y.cz'; DROP TABLE login_attempt; --"],
            ["x@y.cz' UNION SELECT password_hash FROM `user` --"],
            ["x@y.cz\\' OR 1=1 #"],
            ["'; UPDATE `user` SET is_platform_admin = 1; --"],
        ];
    }

    #[DataProvider('payloads')]
    public function testLoginSurvivesInjectionAttempt(string $payload): void
    {
        $auth = new AuthService(
            $this->db,
            new TokenService($this->db),
            new PasswordService(),
            new RateLimiter($this->db),
        );

        [, $teamId] = $this->makeTeam('sk-prosek', 'Prosek - muži');
        $userId     = $this->makeUser('skutecny@prosek.cz');
        $this->makeMembership($userId, $teamId, 'player');

        try {
            $auth->login($payload, 'jakekoliv-heslo', null, '127.0.0.1');
            self::fail('přihlášení podvrženým vstupem musí selhat');
        } catch (ApiException $e) {
            self::assertSame(401, $e->status);
        }

        // Struktura ani data se nezměnily.
        self::assertSame(
            1,
            (int) $this->db->value('SELECT COUNT(*) FROM `user`'),
            'nesmí přibýt ani zmizet uživatel',
        );
        self::assertSame(
            0,
            (int) $this->db->value('SELECT COUNT(*) FROM `user` WHERE is_platform_admin = 1'),
            'nikdo nesmí získat práva správce',
        );
        self::assertSame(
            1,
            (int) $this->db->value(
                "SELECT COUNT(*) FROM information_schema.TABLES
                  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'login_attempt'",
            ),
            'tabulka musí zůstat',
        );
    }

    #[DataProvider('payloads')]
    public function testPayloadIsStoredVerbatim(string $payload): void
    {
        // Uložení jako text, ne jako část SQL.
        $limiter = new RateLimiter($this->db);
        $limiter->record($payload, '127.0.0.1', false);

        self::assertSame(
            $payload,
            $this->db->value('SELECT email FROM login_attempt ORDER BY id DESC LIMIT 1'),
        );
    }
}
