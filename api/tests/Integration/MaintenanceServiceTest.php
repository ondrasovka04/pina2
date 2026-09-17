<?php

declare(strict_types=1);

namespace Pina\Tests\Integration;

use DateTimeImmutable;
use DateTimeZone;
use PHPUnit\Framework\Attributes\DataProvider;
use Pina\Controller\NotificationController;
use Pina\Http\ApiException;
use Pina\Http\Request;
use Pina\Notification\PushGateway;
use Pina\Service\MaintenanceService;
use Pina\Service\NotificationService;

final class MaintenanceServiceTest extends DatabaseTestCase
{
    private const OLD      = '2026-09-17 11:59:59';
    private const BOUNDARY = '2026-09-17 12:00:00';
    private const RECENT   = '2027-09-16 12:00:00';
    private const FUTURE   = '2028-09-17 12:00:00';

    private MaintenanceService $service;
    private int $user;
    private int $team;
    private int $season;

    protected function setUp(): void
    {
        parent::setUp();
        $this->service  = new MaintenanceService($this->db);
        $this->user     = $this->makeUser('maintenance@example.test');
        [, $this->team] = $this->makeTeam('maintenance', 'Úklid');
        $this->season   = $this->makeSeason($this->team, '2026/27');
    }

    /** @return list<array{string,string,string}> */
    public static function tokenTables(): array
    {
        return [
            ['refresh_token', 'revoked_at', 'refreshTokens'],
            ['password_reset', 'used_at', 'passwordResets'],
            ['invitation', 'accepted_at', 'invitations'],
        ];
    }

    #[DataProvider('tokenTables')]
    public function testTokensWaitAYearAfterExpiryAndLastUse(string $table, string $terminal, string $resultKey): void
    {
        $expected = [];
        foreach ([
            [self::OLD, null, false],
            [self::OLD, self::OLD, false],
            [self::BOUNDARY, null, true],
            [self::RECENT, null, true],
            [self::FUTURE, null, true],
            [self::FUTURE, self::OLD, true],
            [self::OLD, self::BOUNDARY, true],
            [self::OLD, self::RECENT, true],
        ] as [$expires, $ended, $keep]) {
            $id = $this->token($table, $terminal, $expires, $ended);
            if ($keep) {
                $expected[] = $id;
            }
        }

        self::assertSame(2, $this->service->cleanup($this->now())[$resultKey]);
        self::assertSame($expected, $this->ids($table));
        self::assertSame(0, $this->service->cleanup($this->now())[$resultKey]);
    }

    public function testCalendarFeedsMustHaveBeenRevokedForAYear(): void
    {
        $expected = [];
        foreach ([self::OLD, self::BOUNDARY, self::RECENT, null] as $revoked) {
            $this->db->run('INSERT INTO calendar_feed (user_id, team_id, season_id, token_hash, created_at, revoked_at)
                VALUES (?, ?, ?, ?, ?, ?)', [$this->user, $this->team, $this->season, $this->hash(), self::OLD, $revoked]);
            if ($revoked !== self::OLD) {
                $expected[] = $this->db->lastInsertId();
            }
        }
        self::assertSame(1, $this->service->cleanup($this->now())['calendarFeeds']);
        self::assertSame($expected, $this->ids('calendar_feed'));
    }

    public function testOnlyOldFinishedDeliveriesAreDeletedAcrossAllDevices(): void
    {
        $sent = $this->notification(self::OLD);
        $this->delivery($sent, 'sent', self::OLD, self::OLD);
        $failed = $this->notification(self::OLD);
        $this->delivery($failed, 'failed', self::OLD);
        $this->notification(self::OLD); // Bez odběru: existuje jen deduplikační záznam.
        $expected = [$this->notification(self::BOUNDARY), $this->notification(self::RECENT)];
        foreach ([
            ['pending', self::OLD, null],
            ['processing', self::OLD, null],
            ['sent', self::OLD, self::BOUNDARY],
            ['sent', self::OLD, self::RECENT],
            ['sent', self::OLD, null], // Nekonzistentní datum: raději ponechat.
            ['failed', self::BOUNDARY, null],
            ['failed', self::RECENT, null],
        ] as [$status, $scheduled, $sentAt]) {
            $id         = $this->notification(self::OLD);
            $expected[] = $id;
            $this->delivery($id, $status, $scheduled, $sentAt);
        }
        $multiple   = $this->notification(self::OLD);
        $expected[] = $multiple;
        $this->delivery($multiple, 'sent', self::OLD, self::OLD);
        $this->delivery($multiple, 'pending', self::OLD);
        // Mladá zpráva nesmí zmizet ani při starém send_after.
        $fresh      = $this->notification(self::RECENT);
        $expected[] = $fresh;
        $this->delivery($fresh, 'failed', self::OLD);

        $subscriptions = $this->ids('push_subscription');
        $result        = $this->service->cleanup($this->now());
        self::assertSame(3, $result['notificationDeliveries']);
        self::assertSame(3, $result['notifications']);
        self::assertSame($expected, $this->ids('notification'));
        self::assertSame($subscriptions, $this->ids('push_subscription'));
        self::assertSame(9, $this->db->value('SELECT COUNT(*) FROM notification_queue'));
        self::assertSame(0, array_sum($this->service->cleanup($this->now())));
    }

    public function testBatchesAreBoundedAndContinueOnNextRun(): void
    {
        for ($i = 0; $i < 501; $i++) {
            $this->token('refresh_token', 'revoked_at', self::OLD);
            $this->notification(self::OLD);
        }
        $first = $this->service->cleanup($this->now());
        self::assertSame(500, $first['refreshTokens']);
        self::assertSame(500, $first['notifications']);
        self::assertCount(1, $this->ids('refresh_token'));
        self::assertCount(1, $this->ids('notification'));
        $second = $this->service->cleanup($this->now());
        self::assertSame(1, $second['refreshTokens']);
        self::assertSame(1, $second['notifications']);
    }

    public function testCleanupPreservesPeopleMoneyAuditAndPreferences(): void
    {
        $member = $this->makeMembership($this->user, $this->team, 'admin');
        $this->makeRoster($this->season, [$member]);
        $this->makeRecord($this->season, $member, 123);
        $this->db->run(
            'INSERT INTO payment (season_id, membership_id, amount_czk, paid_on) VALUES (?, ?, 23, ?)',
            [$this->season, $member, '2020-01-01'],
        );
        $this->db->run("INSERT INTO audit_log (team_id, actor_user_id, action, entity, created_at)
            VALUES (?, ?, 'test', 'payment', '2020-01-01')", [$this->team, $this->user]);
        $this->db->run("INSERT INTO notification_pref (user_id, channel, event_type, enabled)
            VALUES (?, 'push', 'offence_batch', 0)", [$this->user]);
        $tables = ['user', 'membership', 'roster_entry', 'offence_record', 'payment', 'audit_log', 'notification_pref'];
        $before = [];
        foreach ($tables as $table) {
            $before[$table] = $this->db->all("SELECT * FROM `$table`");
        }
        $this->token('refresh_token', 'revoked_at', self::OLD);
        // UTC vstup i noční klid nesmějí změnit výpočet retenční doby v Praze.
        $result = $this->service->cleanup(new DateTimeImmutable('2027-09-17 21:30:00', new DateTimeZone('UTC')));
        self::assertSame(1, $result['refreshTokens']);
        foreach ($tables as $table) {
            self::assertSame($before[$table], $this->db->all("SELECT * FROM `$table`"), $table);
        }
    }

    public function testCronAuthenticatesBeforeCleanupAndReturnsCountsWithoutCaching(): void
    {
        $this->token('refresh_token', 'revoked_at', '2000-01-01 00:00:00');
        $gateway = $this->createMock(PushGateway::class);
        $gateway->expects(self::never())->method('deliver');
        $notifications = new NotificationService($this->db, $gateway, '');
        foreach ([['secret', null], ['secret', 'wrong'], ['', '']] as [$configured, $given]) {
            $controller = new NotificationController($notifications, $configured, $this->service);
            $request    = new Request('GET', '/api/v1/cron/notifications/send', $given === null ? [] : ['token' => $given], [], [], '127.0.0.1');
            try {
                $controller->sendQueue($request);
                self::fail('Neověřený cron nesmí mazat data.');
            } catch (ApiException $e) {
                self::assertSame(404, $e->status);
            }
            self::assertCount(1, $this->ids('refresh_token'));
        }
        $controller = new NotificationController($notifications, 'secret', $this->service);
        $response   = $controller->sendQueue(new Request('GET', '/api/v1/cron/notifications/send', ['token' => 'secret'], [], [], '127.0.0.1'));
        self::assertSame(200, $response->status);
        self::assertSame('no-store', $response->headers['Cache-Control']);
        $data = $response->data;
        self::assertIsArray($data);
        self::assertArrayHasKey('cleanup', $data);
        self::assertIsArray($data['cleanup']);
        self::assertArrayHasKey('refreshTokens', $data['cleanup']);
        self::assertSame(1, $data['cleanup']['refreshTokens']);
        self::assertSame([], $this->ids('refresh_token'));
    }

    private function now(): DateTimeImmutable
    {
        return new DateTimeImmutable('2027-09-17 12:00:00', new DateTimeZone('Europe/Prague'));
    }

    private function hash(): string
    {
        return bin2hex(random_bytes(32));
    }

    private function token(string $table, string $terminal, string $expires, ?string $ended = null): int
    {
        if ($table === 'invitation') {
            $this->db->run('INSERT INTO invitation (team_id, email, token_hash, expires_at, accepted_at, created_at)
                VALUES (?, ?, ?, ?, ?, ?)', [$this->team, 'maintenance@example.test', $this->hash(), $expires, $ended, '2020-01-01']);
        } else {
            $this->db->run("INSERT INTO `$table` (user_id, token_hash, expires_at, `$terminal`, created_at)
                VALUES (?, ?, ?, ?, ?)", [$this->user, $this->hash(), $expires, $ended, '2020-01-01']);
        }
        return $this->db->lastInsertId();
    }

    private function notification(string $created): int
    {
        $this->db->run("INSERT INTO notification (user_id, type, title, body, dedupe_key, created_at)
            VALUES (?, 'offence_batch', 'Zápis', 'Nový zápis', ?, ?)", [$this->user, $this->hash(), $created]);
        return $this->db->lastInsertId();
    }

    private function delivery(int $notification, string $status, string $scheduled, ?string $sent = null): void
    {
        $hash = $this->hash();
        $this->db->run("INSERT INTO push_subscription (user_id, device_id, endpoint, endpoint_hash, p256dh, auth)
            VALUES (?, ?, 'https://example.test/push', ?, 'key', 'auth')", [$this->user, substr($hash, 0, 32), $hash]);
        $this->db->run('INSERT INTO notification_queue (notification_id, push_subscription_id, status, send_after, sent_at)
            VALUES (?, ?, ?, ?, ?)', [$notification, $this->db->lastInsertId(), $status, $scheduled, $sent]);
    }

    /** @return list<int> */
    private function ids(string $table): array
    {
        return array_map(static fn (array $row): int => (int) $row['id'], $this->db->all("SELECT id FROM `$table` ORDER BY id"));
    }
}
