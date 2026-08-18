<?php

declare(strict_types=1);

namespace Pina\Tests\Integration;

use PDO;
use PHPUnit\Framework\TestCase;
use Pina\Support\Database;

/** Schéma jednou, data se mažou před každým testem. */
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

    /** Pojistka — testy maží všechno, jen proti test DB. */
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

        return [$clubId, $this->makeTeamInClub($clubId, $teamName)];
    }

    /** Druhé družstvo téhož klubu — na ověření, že se nastavení nesdílí. */
    protected function makeTeamInClub(int $clubId, string $teamName): int
    {
        $this->db->run('INSERT INTO team (club_id, name) VALUES (?, ?)', [$clubId, $teamName]);

        return $this->db->lastInsertId();
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

    /**
     * Soupiska, ne členství — přehledy na ní závisejí.
     *
     * @param list<int> $membershipIds
     */
    protected function makeRoster(int $seasonId, array $membershipIds): void
    {
        foreach ($membershipIds as $membershipId) {
            $this->db->run(
                'INSERT INTO roster_entry (season_id, membership_id) VALUES (?, ?)',
                [$seasonId, $membershipId],
            );
        }
    }

    /** Zápis bez sazebníku a dávky — jen aby byl dluh. */
    protected function makeRecord(int $seasonId, int $membershipId, int $amountCzk = 50, bool $voided = false): int
    {
        $this->db->run(
            'INSERT INTO offence_type (season_id, name, amount_czk) VALUES (?, ?, ?)',
            [$seasonId, 'Pozdní příchod ' . $membershipId, $amountCzk],
        );
        $typeId = $this->db->lastInsertId();

        $this->db->run(
            'INSERT INTO offence_record (season_id, membership_id, offence_type_id, amount_czk, occurred_on, voided_at)
             VALUES (?, ?, ?, ?, ?, ?)',
            [$seasonId, $membershipId, $typeId, $amountCzk, '2026-09-15', $voided ? '2026-09-16 10:00:00' : null],
        );

        return $this->db->lastInsertId();
    }
}
