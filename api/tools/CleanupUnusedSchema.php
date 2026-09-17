<?php

declare(strict_types=1);

namespace Pina\Tools;

use Pina\Support\Database;
use RuntimeException;

/** Jednorázový úklid existující DB. Spouštět až po nahrání kompatibilního API. */
final class CleanupUnusedSchema
{
    public function __construct(private readonly Database $db)
    {
    }

    /** @return list<string> SQL bez provedení změn; všechny kontroly před prvním DDL. */
    public function plan(): array
    {
        $statements = [];
        foreach ([
            ['team', 'color', 'color IS NOT NULL'],
            ['notification', 'payload', 'payload IS NOT NULL'],
            ['notification', 'read_at', 'read_at IS NOT NULL'],
            ['notification_queue', 'channel', "channel <> 'push'"],
        ] as [$table, $column, $unexpected]) {
            if ($this->columnType($table, $column) === null) {
                continue;
            }

            $this->assertEmpty($table, $column, $unexpected);
            // Identifikátory i podmínky pocházejí výhradně z konstant výše.
            $statements[] = "ALTER TABLE `$table` DROP COLUMN `$column`";
        }

        foreach ([
            ['payment', 'method', 'gateway', "ENUM('cash','transfer','qr') NOT NULL DEFAULT 'cash'"],
            ['offence_type', 'auto_rule', 'late_arrival', "ENUM('none','excused_absence','unexcused_absence','late_rsvp') NOT NULL DEFAULT 'none'"],
        ] as [$table, $column, $obsolete, $definition]) {
            if (!str_contains($this->columnType($table, $column) ?? '', "'$obsolete'")) {
                continue;
            }

            $this->assertEmpty($table, $column, "`$column` = '$obsolete'");
            $statements[] = "ALTER TABLE `$table` MODIFY COLUMN `$column` $definition";
        }

        return $statements;
    }

    /** @return list<string> Provedené příkazy; opakované spuštění už nic nemění. */
    public function run(): array
    {
        $statements = $this->plan();
        // MySQL DDL nelze vrátit transakcí. Při technickém selhání lze migraci zopakovat.
        foreach ($statements as $sql) {
            $this->db->run($sql);
        }

        return $statements;
    }

    private function columnType(string $table, string $column): ?string
    {
        $type = $this->db->value(
            'SELECT COLUMN_TYPE FROM information_schema.COLUMNS
             WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ?',
            [$table, $column],
        );

        return $type === null ? null : (string) $type;
    }

    private function assertEmpty(string $table, string $column, string $condition): void
    {
        if ((int) $this->db->value("SELECT COUNT(*) FROM `$table` WHERE $condition") > 0) {
            throw new RuntimeException("Úklid zastaven: $table.$column obsahuje používaná data.");
        }
    }
}
