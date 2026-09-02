<?php

declare(strict_types=1);

namespace Pina\Service;

use Pina\Http\ApiException;
use Pina\Support\Database;

/** Jediné místo, které rozhoduje, zda družstvo používá modul akcí a docházky. */
final class AttendanceModule
{
    /** Do dotazů, které řeší víc družstev naráz; očekává `team_settings` jako `ts`. */
    public const SQL_ENABLED = 'COALESCE(ts.attendance_enabled, 1) = 1';

    public function __construct(private readonly Database $db)
    {
    }

    public function enabled(int $teamId): bool
    {
        return (bool) $this->db->value(
            'SELECT COALESCE(ts.attendance_enabled, 1)
               FROM team t
               LEFT JOIN team_settings ts ON ts.team_id = t.id
              WHERE t.id = ?',
            [$teamId],
        );
    }

    public function assertEnabled(int $teamId): void
    {
        if (!$this->enabled($teamId)) {
            throw ApiException::conflict('ATTENDANCE_DISABLED', 'Tohle družstvo vede docházku jinde.');
        }
    }
}
