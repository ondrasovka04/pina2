<?php

declare(strict_types=1);

namespace Pina\Tests\Integration;

use DateTimeImmutable;
use DateTimeZone;
use Pina\Auth\Identity;
use Pina\Notification\PushDelivery;
use Pina\Notification\PushGateway;
use Pina\Service\NotificationService;

final class NotificationServiceTest extends DatabaseTestCase
{
    private FakePushGateway $gateway;
    private NotificationService $notifications;
    private int $userId;
    private Identity $identity;

    protected function setUp(): void
    {
        parent::setUp();

        $this->gateway       = new FakePushGateway();
        $this->notifications = new NotificationService($this->db, $this->gateway, 'verejny-klic');
        $this->userId        = $this->makeUser('hrac@example.test');
        $this->identity      = new Identity($this->userId, 'hrac@example.test', 'Hráč', false, []);
    }

    public function testDefaultsKeepMoneyCategoriesDisabled(): void
    {
        $settings = $this->notifications->settings($this->identity);

        self::assertSame([
            'eventReminder' => true,
            'offenceBatch'  => false,
        ], $settings['preferences']);
        self::assertTrue($settings['available']);
        self::assertSame(0, $settings['subscriptionCount']);
    }

    public function testReminderIsDeduplicatedAndNeverSentAtNight(): void
    {
        $eventId = $this->makeTomorrowEvent();
        $this->subscribe();
        $evening = $this->time('today 18:30');

        self::assertSame(1, $this->notifications->enqueueEventReminders($evening));
        self::assertSame(0, $this->notifications->enqueueEventReminders($evening));
        self::assertSame(1, (int) $this->db->value('SELECT COUNT(*) FROM notification WHERE dedupe_key = ?', [
            'event:' . $eventId,
        ]));

        $night = $this->notifications->flush($this->time('today 23:30'));
        self::assertTrue($night['suppressed']);
        self::assertSame([], $this->gateway->messages);

        $this->db->run("UPDATE notification_queue SET send_after = '2000-01-01 00:00:00'");
        $day = $this->notifications->flush($this->time('today 20:00'));
        self::assertSame(1, $day['sent']);
        self::assertCount(1, $this->gateway->messages);

        self::assertSame(0, $this->notifications->flush($this->time('today 20:01'))['claimed']);
    }

    public function testDeadlineReminderIsQueuedWithinTwelveHoursOnlyForUnknownAnswer(): void
    {
        $eventId = $this->makeTomorrowEvent(withDeadline: true);

        self::assertSame(0, $this->notifications->enqueueEventReminders($this->time('today 07:59')));
        self::assertSame(1, $this->notifications->enqueueEventReminders($this->time('today 08:00')));
        self::assertSame(0, $this->notifications->enqueueEventReminders($this->time('today 08:01')));

        self::assertSame('Blíží se termín zápisu na akci', $this->db->value(
            'SELECT title FROM notification WHERE dedupe_key = ?',
            ['event:' . $eventId],
        ));
        self::assertSame('Odpověz do 18:00, pak už to bude pozdní zápis.', $this->db->value(
            'SELECT body FROM notification WHERE dedupe_key = ?',
            ['event:' . $eventId],
        ));
    }

    /** Připomínka chodí dvanáct hodin předem, takže termín přeteče přes půlnoc. */
    public function testDeadlineReminderNamesTheDayWhenItIsNotToday(): void
    {
        $eventId = $this->makeTomorrowEvent(withDeadline: true);
        $this->db->run(
            'UPDATE event SET starts_at = ? WHERE id = ?',
            [$this->time('tomorrow 08:00')->modify('+1 day')->format('Y-m-d H:i:s'), $eventId],
        );

        self::assertSame(1, $this->notifications->enqueueEventReminders($this->time('today 21:00')));
        self::assertSame('Odpověz do zítřejších 08:00, pak už to bude pozdní zápis.', $this->db->value(
            'SELECT body FROM notification WHERE dedupe_key = ?',
            ['event:' . $eventId],
        ));
    }

    public function testDeadlineReminderSkipsPlayerWhoAlreadyAnswered(): void
    {
        $eventId      = $this->makeTomorrowEvent(withDeadline: true);
        $membershipId = (int) $this->db->value('SELECT id FROM membership WHERE user_id = ?', [$this->userId]);
        $this->db->run(
            "INSERT INTO event_participant (event_id, membership_id, rsvp, rsvp_at)
             VALUES (?, ?, 'yes', NOW())",
            [$eventId, $membershipId],
        );

        self::assertSame(0, $this->notifications->enqueueEventReminders($this->time('today 08:00')));
    }

    public function testDisablingCategoryRemovesPendingDeliveryImmediately(): void
    {
        $this->makeTomorrowEvent();
        $this->subscribe();
        self::assertSame(1, $this->notifications->enqueueEventReminders($this->time('today 18:30')));

        $this->notifications->savePreferences($this->identity, [
            'eventReminder' => false,
            'offenceBatch'  => false,
        ]);

        self::assertSame(0, (int) $this->db->value('SELECT COUNT(*) FROM notification_queue'));
        self::assertSame(0, $this->notifications->flush($this->time('today 20:00'))['claimed']);
        self::assertSame([], $this->gateway->messages);
    }

    public function testExpiredSubscriptionIsDeletedAfterPushResponse(): void
    {
        $this->makeTomorrowEvent();
        $this->subscribe();
        $this->notifications->enqueueEventReminders($this->time('today 18:30'));
        $this->db->run("UPDATE notification_queue SET send_after = '2000-01-01 00:00:00'");
        $this->gateway->next = PushDelivery::expired('410 Gone');

        $result = $this->notifications->flush($this->time('today 20:00'));

        self::assertSame(1, $result['expired']);
        self::assertSame(0, (int) $this->db->value('SELECT COUNT(*) FROM push_subscription'));
        self::assertSame(0, (int) $this->db->value('SELECT COUNT(*) FROM notification_queue'));
    }

    public function testLogoutEverywhereCanRemoveAllPushSubscriptions(): void
    {
        $this->subscribe();

        $this->notifications->removeAllSubscriptions($this->userId);

        self::assertSame(0, (int) $this->db->value('SELECT COUNT(*) FROM push_subscription'));
    }

    public function testTemporaryFailureIsRetriedWithoutSendingTwiceInOneRun(): void
    {
        $this->makeTomorrowEvent();
        $this->subscribe();
        $this->notifications->enqueueEventReminders($this->time('today 18:30'));
        $this->db->run("UPDATE notification_queue SET send_after = '2000-01-01 00:00:00'");
        $this->gateway->next = PushDelivery::failed('Push služba neodpovídá.');

        $result = $this->notifications->flush($this->time('today 20:00'));

        self::assertSame(1, $result['retried']);
        self::assertCount(1, $this->gateway->messages);
        self::assertSame('pending', $this->db->value('SELECT status FROM notification_queue'));
        self::assertSame(1, (int) $this->db->value('SELECT attempts FROM notification_queue'));
    }

    public function testOffenceNotificationIsQueuedOnlyAfterExplicitOptInAndContainsNoAmount(): void
    {
        [, $teamId]   = $this->makeTeam('prosek', 'Muži');
        $membershipId = $this->makeMembership($this->userId, $teamId, 'player');
        $seasonId     = $this->makeSeason($teamId, '26/27');
        $this->db->run(
            'INSERT INTO offence_batch (season_id, occurred_on, client_uuid) VALUES (?, ?, ?)',
            [$seasonId, '2026-09-15', '11111111-1111-1111-1111-111111111111'],
        );
        $batchId  = $this->db->lastInsertId();
        $recordId = $this->makeRecord($seasonId, $membershipId, 500);
        $this->db->run('UPDATE offence_record SET batch_id = ? WHERE id = ?', [$batchId, $recordId]);
        $this->subscribe();

        $this->notifications->savePreferences($this->identity, [
            'eventReminder' => true,
            'offenceBatch'  => true,
        ]);
        self::assertSame(1, $this->notifications->enqueueOffenceBatch($batchId));

        $body = (string) $this->db->value('SELECT body FROM notification');
        self::assertStringNotContainsString('500', $body);
        self::assertStringNotContainsString('hrac', $body);
        self::assertSame(1, (int) $this->db->value('SELECT COUNT(*) FROM notification_queue'));
    }

    /** Skript zabitý hostingem uprostřed fronty by nechal zbytek deset minut zamčený. */
    public function testRunOutOfTimeReturnsUnsentDeliveriesToQueue(): void
    {
        $this->makeTomorrowEvent();
        $this->subscribe();
        $this->subscribe('druhy-telefon');
        $this->notifications->enqueueEventReminders($this->time('today 18:30'));
        $this->db->run("UPDATE notification_queue SET send_after = '2000-01-01 00:00:00'");
        $this->gateway->delayMicroseconds = 20_000;

        $result = $this->notifications->flush($this->time('today 20:00'), budgetSeconds: 0.01);

        self::assertSame(2, $result['claimed']);
        self::assertSame(1, $result['sent']);
        self::assertSame(1, $result['deferred']);
        self::assertCount(1, $this->gateway->messages);
        self::assertSame(1, (int) $this->db->value(
            "SELECT COUNT(*) FROM notification_queue WHERE status = 'pending' AND locked_at IS NULL AND attempts = 0",
        ));
    }

    /**
     * Prohlížeč vydá po přeinstalaci service workera novou adresu odběru. Bez
     * úklidu po `device_id` zůstal ten starý řádek v databázi a aplikace pak
     * tvrdila „aktivní na jiném zařízení", i když jiné zařízení neexistovalo.
     */
    public function testNewEndpointFromSameDeviceReplacesTheOldOne(): void
    {
        $device = str_repeat('a', 32);
        foreach (['prvni', 'druha'] as $endpoint) {
            $this->notifications->subscribe($this->identity, [
                'endpoint'        => 'https://push.example.test/' . $endpoint,
                'p256dh'          => 'abc_DEF-123',
                'auth'            => 'auth_ABC-456',
                'contentEncoding' => 'aes128gcm',
                'deviceId'        => $device,
            ]);
        }

        self::assertSame(1, $this->notifications->settings($this->identity)['subscriptionCount']);
        self::assertSame(
            'https://push.example.test/druha',
            $this->db->value('SELECT endpoint FROM push_subscription'),
        );
    }

    public function testSubscriptionFromAnotherDeviceIsKept(): void
    {
        $this->subscribe('telefon');
        $this->subscribe('notebook');

        self::assertSame(2, $this->notifications->settings($this->identity)['subscriptionCount']);
    }

    private function subscribe(string $device = 'telefon'): void
    {
        $this->notifications->subscribe($this->identity, [
            'endpoint'        => 'https://push.example.test/' . $device . '-' . $this->userId,
            'p256dh'          => 'abc_DEF-123',
            'auth'            => 'auth_ABC-456',
            'contentEncoding' => 'aes128gcm',
            'deviceId'        => substr(md5($device), 0, 32),
        ]);
    }

    private function makeTomorrowEvent(bool $withDeadline = false): int
    {
        [, $teamId]   = $this->makeTeam('prosek', 'Muži');
        $membershipId = $this->makeMembership($this->userId, $teamId, 'player');
        $seasonId     = $this->makeSeason($teamId, '26/27');
        $this->makeRoster($seasonId, [$membershipId]);

        if (!$withDeadline) {
            $this->db->run(
                'INSERT INTO team_settings
                     (team_id, rsvp_deadline_training_hours, rsvp_deadline_match_hours)
                 VALUES (?, NULL, NULL)',
                [$teamId],
            );
        }

        $this->db->run(
            'INSERT INTO event (season_id, type, title, starts_at) VALUES (?, ?, ?, ?)',
            [$seasonId, 'training', 'Trénink', $this->time('tomorrow 18:00')->format('Y-m-d H:i:s')],
        );

        return $this->db->lastInsertId();
    }

    private function time(string $value): DateTimeImmutable
    {
        return new DateTimeImmutable($value, new DateTimeZone('Europe/Prague'));
    }
}

final class FakePushGateway implements PushGateway
{
    public PushDelivery $next;

    /** Napodobí push službu, která odpovídá pomalu. */
    public int $delayMicroseconds = 0;

    /** @var list<array{title:string,body:string,link:string}> */
    public array $messages = [];

    public function __construct()
    {
        $this->next = PushDelivery::delivered();
    }

    public function deliver(array $subscription, array $message): PushDelivery
    {
        if ($this->delayMicroseconds > 0) {
            usleep($this->delayMicroseconds);
        }

        $this->messages[] = $message;

        return $this->next;
    }
}
