<?php

declare(strict_types=1);

namespace Pina\Tests\Integration;

use PHPUnit\Framework\Attributes\DataProvider;
use Pina\Tools\CleanupUnusedSchema;
use RuntimeException;

require_once __DIR__ . '/../../tools/CleanupUnusedSchema.php';

final class SchemaCleanupTest extends DatabaseTestCase
{
    private CleanupUnusedSchema $migration;

    protected function setUp(): void
    {
        parent::setUp();
        $this->migration = new CleanupUnusedSchema($this->db);
        $this->db->run('ALTER TABLE team ADD color VARCHAR(7) NULL');
        $this->db->run('ALTER TABLE notification ADD payload JSON NULL, ADD read_at DATETIME NULL,
            DROP INDEX ix_notification_user, ADD INDEX ix_notification_user (user_id, read_at, created_at)');
        $this->db->run("ALTER TABLE notification_queue ADD channel ENUM('push') NOT NULL DEFAULT 'push'");
        $this->db->run("ALTER TABLE payment MODIFY method ENUM('cash','transfer','qr','gateway') NOT NULL DEFAULT 'cash'");
        $this->db->run("ALTER TABLE offence_type MODIFY auto_rule ENUM('none','excused_absence','unexcused_absence','late_arrival','late_rsvp') NOT NULL DEFAULT 'none'");

        [, $team]   = $this->makeTeam('cleanup', 'Úklid');
        $user       = $this->makeUser('cleanup@example.test');
        $membership = $this->makeMembership($user, $team, 'player');
        $season     = $this->makeSeason($team, '2026');
        $this->db->run("INSERT INTO payment (season_id, membership_id, amount_czk, paid_on, method)
            VALUES (?, ?, 123, '2026-09-17', 'qr')", [$season, $membership]);
        $this->db->run("INSERT INTO offence_type (season_id, name, amount_czk, auto_rule)
            VALUES (?, 'Pozdní zápis', 20, 'late_rsvp')", [$season]);
        $this->db->run("INSERT INTO notification (user_id, type, title, body, dedupe_key)
            VALUES (?, 'offence_batch', 'Zápis', 'Nový zápis', 'cleanup')", [$user]);
        $notification = $this->db->lastInsertId();
        $this->db->run("INSERT INTO push_subscription (user_id, device_id, endpoint, endpoint_hash, p256dh, auth)
            VALUES (?, 'cleanup', 'https://example.test/push', ?, 'key', 'auth')", [$user, hash('sha256', 'cleanup')]);
        $this->db->run(
            'INSERT INTO notification_queue (notification_id, push_subscription_id) VALUES (?, ?)',
            [$notification, $this->db->lastInsertId()],
        );
    }

    protected function tearDown(): void
    {
        // Vrátit společné testovací schéma i po odmítnutí migrace nebo selhání assertion.
        foreach (['team' => 'color', 'notification' => 'payload, read_at'] as $table => $columns) {
            foreach (explode(', ', $columns) as $column) {
                if ($this->hasColumn($table, $column)) {
                    $this->db->run("UPDATE `$table` SET `$column` = NULL");
                }
            }
        }
        $this->db->run("UPDATE payment SET method = 'cash' WHERE method = 'gateway'");
        $this->db->run("UPDATE offence_type SET auto_rule = 'none' WHERE auto_rule = 'late_arrival'");
        $this->migration->run();
        parent::tearDown();
    }

    public function testCleanupPreservesDataAndCanBeRepeated(): void
    {
        self::assertCount(6, $this->migration->plan());
        self::assertTrue($this->hasColumn('team', 'color'), 'Náhled nesmí změnit schéma.');
        self::assertCount(6, $this->migration->run());
        self::assertSame([], $this->migration->run());
        self::assertFalse($this->hasColumn('notification_queue', 'channel'));
        self::assertFalse($this->hasColumn('notification', 'payload'));
        self::assertSame(['user_id', 'created_at'], array_column($this->db->all(
            "SHOW INDEX FROM notification WHERE Key_name = 'ix_notification_user'",
        ), 'Column_name'));
        self::assertSame(123, $this->db->value('SELECT amount_czk FROM payment'));
        self::assertSame('qr', $this->db->value('SELECT method FROM payment'));
        self::assertSame('late_rsvp', $this->db->value('SELECT auto_rule FROM offence_type'));
        self::assertSame('Nový zápis', $this->db->value('SELECT body FROM notification'));
        self::assertSame('pending', $this->db->value('SELECT status FROM notification_queue'));
        self::assertTrue($this->hasColumn('payment', 'bank_transaction_id'));
    }

    /** @return list<array{string,string}> */
    public static function usedData(): array
    {
        return [
            ["UPDATE team SET color = '#ffffff'", 'team.color'],
            ["UPDATE notification SET payload = JSON_OBJECT('key', 'value')", 'notification.payload'],
            ['UPDATE notification SET read_at = NOW()', 'notification.read_at'],
            ["UPDATE payment SET method = 'gateway'", 'payment.method'],
            ["UPDATE offence_type SET auto_rule = 'late_arrival'", 'offence_type.auto_rule'],
        ];
    }

    #[DataProvider('usedData')]
    public function testUsedDataStopsMigrationBeforeAnySchemaChanges(string $sql, string $column): void
    {
        $this->db->run($sql);
        try {
            $this->migration->run();
            self::fail('Migrace nesmí zahodit používaná data.');
        } catch (RuntimeException $e) {
            self::assertStringContainsString($column, $e->getMessage());
        }
        self::assertTrue($this->hasColumn('team', 'color'));
        self::assertTrue($this->hasColumn('notification', 'payload'));
        self::assertTrue($this->hasColumn('notification', 'read_at'));
        self::assertTrue($this->hasColumn('notification_queue', 'channel'));
    }

    private function hasColumn(string $table, string $column): bool
    {
        return (int) $this->db->value('SELECT COUNT(*) FROM information_schema.COLUMNS
            WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ?', [$table, $column]) === 1;
    }
}
