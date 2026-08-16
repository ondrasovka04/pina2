<?php

declare(strict_types=1);

namespace Pina\Tests\Integration;

use PDO;
use Pina\Support\Database;
use PHPUnit\Framework\TestCase;

/**
 * Základ pro testy sahající na skutečnou MySQL. Schéma se vytvoří jednou
 * pro celý běh, data se před každým testem promažou.
 */
abstract class DatabaseTestCase extends TestCase
{
    protected Database $db;

    private static bool $schemaReady = false;

    protected function setUp(): void
    {
        $this->guardAgainstWrongDatabase();

        $this->db = new Database();

        if (!self::$schemaReady) {
            $this->createSchema();
            self::$schemaReady = true;
        }

        $this->truncateAll();
    }

    /**
     * Pojistka proti smazání dat. Testy mažou obsah všech tabulek, takže musí
     * běžet výhradně proti databázi určené k testování — nikdy proti vývojové
     * ani produkční.
     */
    private function guardAgainstWrongDatabase(): void
    {
        $name = (string) (getenv('DB_NAME') ?: '');

        if (!str_contains($name, 'test')) {
            self::fail(
                "Testy by smazaly obsah databáze '$name'. Název testovací databáze "
                . 'musí obsahovat "test" (viz phpunit.xml).',
            );
        }
    }

    private function createSchema(): void
    {
        $pdo = new PDO(
            sprintf('mysql:host=%s;charset=utf8mb4', getenv('DB_HOST') ?: 'db'),
            getenv('DB_USER') ?: 'root',
            getenv('DB_PASSWORD') ?: 'root',
            [PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION],
        );

        $name = getenv('DB_NAME') ?: 'pina_test';
        $pdo->exec("DROP DATABASE IF EXISTS `$name`");
        $pdo->exec("CREATE DATABASE `$name` CHARACTER SET utf8mb4 COLLATE utf8mb4_czech_ci");
        $pdo->exec("USE `$name`");

        $sql = file_get_contents(__DIR__ . '/../../db/migrations/001_init.sql');
        self::assertIsString($sql);
        $pdo->exec($sql);
    }

    private function truncateAll(): void
    {
        $pdo = $this->db->pdo();
        $pdo->exec('SET FOREIGN_KEY_CHECKS = 0');

        $tables = $this->db->all(
            'SELECT TABLE_NAME AS t FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE()',
        );
        foreach ($tables as $row) {
            if ($row['t'] !== 'schema_migration') {
                $pdo->exec("TRUNCATE TABLE `{$row['t']}`");
            }
        }

        $pdo->exec('SET FOREIGN_KEY_CHECKS = 1');
    }

    /**
     * Založí klub s jedním týmem.
     *
     * @return array{int,int} [clubId, teamId]
     */
    protected function makeTeam(string $slug, string $teamName): array
    {
        $this->db->run('INSERT INTO club (name, slug) VALUES (?, ?)', [$slug, $slug]);
        $clubId = $this->db->lastInsertId();

        $this->db->run('INSERT INTO team (club_id, name) VALUES (?, ?)', [$clubId, $teamName]);

        return [$clubId, $this->db->lastInsertId()];
    }

    protected function makeUser(string $email): int
    {
        $this->db->run(
            'INSERT INTO `user` (email, display_name) VALUES (?, ?)',
            [$email, explode('@', $email)[0]],
        );

        return $this->db->lastInsertId();
    }

    protected function makeMembership(int $userId, int $teamId, string $role, string $status = 'active'): int
    {
        $this->db->run(
            'INSERT INTO membership (user_id, team_id, role, payment_reference, status)
             VALUES (?, ?, ?, ?, ?)',
            [$userId, $teamId, $role, sprintf('%04d%04d', $teamId, $userId), $status],
        );

        return $this->db->lastInsertId();
    }

    protected function makeSeason(int $teamId, string $name, ?string $closedAt = null): int
    {
        $this->db->run(
            'INSERT INTO season (team_id, name, starts_on, ends_on, closed_at)
             VALUES (?, ?, ?, ?, ?)',
            [$teamId, $name, '2026-09-01', '2027-06-30', $closedAt],
        );

        return $this->db->lastInsertId();
    }
}
