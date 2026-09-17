<?php

declare(strict_types=1);

namespace Pina\Service;

use DateTimeImmutable;
use DateTimeZone;
use Pina\Support\Database;

/** Omezený úklid provozních záznamů; žádná historie lidí, peněz ani auditu. */
final class MaintenanceService
{
    public const RETENTION_DAYS = 365;
    private const BATCH_SIZE    = 500;

    public function __construct(private readonly Database $db)
    {
    }

    /**
     * Každé volání odstraní nejvýš jednu dávku z každé tabulky. Zbytek počká
     * na další cron, aby první úklid nezablokoval hosting velkou transakcí.
     *
     * @return array{refreshTokens:int,passwordResets:int,invitations:int,calendarFeeds:int,notificationDeliveries:int,notifications:int}
     */
    public function cleanup(?DateTimeImmutable $now = null): array
    {
        $zone   = new DateTimeZone('Europe/Prague');
        $cutoff = ($now ?? new DateTimeImmutable('now', $zone))
            ->setTimezone($zone)->modify('-' . self::RETENTION_DAYS . ' days')->format('Y-m-d H:i:s');

        // Ani starý použitý token nemažeme, pokud jeho původní platnost ještě
        // neskončila před rokem. Refresh navíc drží důkaz o opakovaném použití.
        $refreshTokens = $this->db->run(
            'DELETE FROM refresh_token WHERE expires_at < ? AND (revoked_at IS NULL OR revoked_at < ?)
             ORDER BY id LIMIT ?',
            [$cutoff, $cutoff, self::BATCH_SIZE],
        )->rowCount();
        $passwordResets = $this->db->run(
            'DELETE FROM password_reset WHERE expires_at < ? AND (used_at IS NULL OR used_at < ?)
             ORDER BY id LIMIT ?',
            [$cutoff, $cutoff, self::BATCH_SIZE],
        )->rowCount();
        $invitations = $this->db->run(
            'DELETE FROM invitation WHERE expires_at < ? AND (accepted_at IS NULL OR accepted_at < ?)
             ORDER BY id LIMIT ?',
            [$cutoff, $cutoff, self::BATCH_SIZE],
        )->rowCount();
        $calendarFeeds = $this->db->run(
            'DELETE FROM calendar_feed WHERE revoked_at < ? ORDER BY id LIMIT ?',
            [$cutoff, self::BATCH_SIZE],
        )->rowCount();

        // Nejprve dokončená doručení. Čekající a rozpracovaná fronta se nemaže
        // ani po roce; čerstvé doručení staré zprávy zůstane další celý rok.
        // U failed nemáme datum dokončení, stáří určuje poslední plánovaný pokus.
        $notificationDeliveries = $this->db->run(
            "DELETE FROM notification_queue
             WHERE ((status = 'sent' AND sent_at < ?) OR (status = 'failed' AND sent_at IS NULL))
               AND send_after < ? AND locked_at IS NULL
               AND EXISTS (SELECT 1 FROM notification n
                           WHERE n.id = notification_queue.notification_id AND n.created_at < ?)
             ORDER BY id LIMIT ?",
            [$cutoff, $cutoff, $cutoff, self::BATCH_SIZE],
        )->rowCount();
        // Kaskádu nepoužíváme: zpráva smí zmizet až po úklidu všech jejích
        // doručení, včetně dalších zařízení téhož uživatele.
        $notifications = $this->db->run(
            'DELETE FROM notification WHERE created_at < ?
             AND NOT EXISTS (SELECT 1 FROM notification_queue q WHERE q.notification_id = notification.id)
             ORDER BY id LIMIT ?',
            [$cutoff, self::BATCH_SIZE],
        )->rowCount();

        return compact('refreshTokens', 'passwordResets', 'invitations', 'calendarFeeds', 'notificationDeliveries', 'notifications');
    }
}
