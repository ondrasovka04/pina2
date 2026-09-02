<?php

declare(strict_types=1);

namespace Pina\Tests\Integration;

use Pina\Http\ApiException;
use Pina\Service\AttendanceModule;

final class AttendanceModuleTest extends DatabaseTestCase
{
    public function testDefaultsToEnabledWithoutSettingsRowAndReadsBothStoredStates(): void
    {
        [, $defaultTeam]  = $this->makeTeam('default', 'Bez nastavení');
        [, $enabledTeam]  = $this->makeTeam('enabled', 'Zapnuto');
        [, $disabledTeam] = $this->makeTeam('disabled', 'Vypnuto');

        $this->db->run(
            'INSERT INTO team_settings (team_id, attendance_enabled) VALUES (?, 1), (?, 0)',
            [$enabledTeam, $disabledTeam],
        );

        $module = new AttendanceModule($this->db);

        self::assertTrue($module->enabled($defaultTeam));
        self::assertTrue($module->enabled($enabledTeam));
        self::assertFalse($module->enabled($disabledTeam));
    }

    public function testDisabledModuleRaisesConflict(): void
    {
        [, $teamId] = $this->makeTeam('disabled', 'Vypnuto');
        $this->db->run('INSERT INTO team_settings (team_id, attendance_enabled) VALUES (?, 0)', [$teamId]);

        try {
            (new AttendanceModule($this->db))->assertEnabled($teamId);
            self::fail('Vypnutý modul musí zápis odmítnout.');
        } catch (ApiException $e) {
            self::assertSame(409, $e->status);
            self::assertSame('ATTENDANCE_DISABLED', $e->errorCode);
            self::assertSame('Tohle družstvo vede docházku jinde.', $e->getMessage());
        }
    }
}
