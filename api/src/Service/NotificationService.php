<?php

declare(strict_types=1);

namespace Pina\Service;

use DateTimeImmutable;
use DateTimeZone;
use Pina\Auth\Identity;
use Pina\Http\ApiException;
use Pina\Notification\PushDelivery;
use Pina\Notification\PushGateway;
use Pina\Support\Database;
use Pina\Support\RsvpDeadline;
use Throwable;

/** Uživatelské volby, deduplikace a odolná fronta Web Push. */
final class NotificationService
{
    public const EVENT_REMINDER = 'event_reminder';
    public const OFFENCE_BATCH  = 'offence_batch';

    /**
     * Kategorie oznámení. Nová bez samostatného souhlasu majitele nesmí vzniknout.
     *
     * Zrušené kategorie, které se nesmí vrátit bez nového rozhodnutí majitele:
     *
     * **Upomínka na dluh** (18. 8. 2026). Vybírá se jednou za pololetí, takže
     * měsíční upomínka připomínala něco, s čím hráč nic dělat nemá, a kdo pořád
     * nezaplatil, se stejně řeší v týmovém chatu.
     *
     * **Nominace** mezi nimi schválně není, i když ji majitel 17. 8. 2026 povolil:
     * aplikace nemá krok „sestava je hotová" (klient posílá jedno jméno po
     * kliknutí) a výchozí stav je „jede celá soupiska", takže se z nominace
     * nikdo nedozvěděl nic nového — první označení náhradníka rozeslalo „jsi
     * v nominaci" všem ostatním a pozdější vyřazení už se neopravilo.
     *
     * Majitel 31. 8. 2026 schválil posun existující připomínky akce před termín
     * zápisu; kategorie zůstává `event_reminder`.
     *
     * @var array<string,array{type:string,default:bool}>
     */
    private const PREFERENCES = [
        'eventReminder' => ['type' => self::EVENT_REMINDER, 'default' => true],
        'offenceBatch'  => ['type' => self::OFFENCE_BATCH, 'default' => false],
    ];

    private const MAX_ATTEMPTS = 5;

    /**
     * Noční klid. Hranici 23:00 zvolil majitel 18. 8. 2026 — dřív tam bylo 21:00,
     * ale pínař zapisuje dávku hned po tréninku nebo zápase, a ty končí v devět
     * i v deset. Oznámení, které lidi zajímá nejvíc, tak vždycky spadlo do
     * zakázaného okna a přišlo až ráno.
     */
    private const QUIET_FROM_HOUR  = 23;
    private const QUIET_UNTIL_HOUR = 8;

    /** Připomínka na zítřejší akci se zakládá až večer, ať vychází z aktuálních RSVP. */
    private const REMINDER_FROM_HOUR = 18;

    /** Stejných 12 hodin používá varovný stav ve frontendu. */
    private const REMINDER_LEAD_HOURS = 12;

    /**
     * Hosting zabije skript po svém limitu a plánovač nemá jak se dozvědět, kde
     * skončil. Běh se proto sám ukončí dřív a nedoručené položky vrátí do
     * fronty; další volání za nimi přijde do patnácti minut.
     */
    private const BUDGET_SECONDS = 20;

    private readonly DateTimeZone $timeZone;

    public function __construct(
        private readonly Database $db,
        private readonly PushGateway $push,
        private readonly string $publicKey,
    ) {
        $this->timeZone = new DateTimeZone('Europe/Prague');
    }

    /** @return array{available:bool,publicKey:string|null,subscriptionCount:int,preferences:array<string,bool>} */
    public function settings(Identity $identity): array
    {
        return [
            'available'         => $this->publicKey !== '',
            'publicKey'         => $this->publicKey === '' ? null : $this->publicKey,
            'subscriptionCount' => (int) $this->db->value(
                'SELECT COUNT(*) FROM push_subscription WHERE user_id = ? AND failed_at IS NULL',
                [$identity->userId],
            ),
            'preferences' => $this->preferences($identity->userId),
        ];
    }

    /**
     * @param array{endpoint:string,p256dh:string,auth:string,contentEncoding:string,deviceId:string} $input
     */
    public function subscribe(Identity $identity, array $input): void
    {
        $this->assertSubscription($input);
        $endpointHash = hash('sha256', $input['endpoint']);

        $this->db->transaction(function () use ($identity, $input, $endpointHash): void {
            // Stejný prohlížeč může po odhlášení patřit jinému účtu.
            // Smazání starého vlastníka odstraní i jeho čekající doručení.
            $this->db->run('DELETE FROM push_subscription WHERE endpoint_hash = ? AND user_id <> ?', [
                $endpointHash,
                $identity->userId,
            ]);

            // Tomu samému zařízení mohl prohlížeč vydat novou adresu (přeinstalovaný
            // service worker, smazaná data webu). Bez tohohle úklidu po sobě jedno
            // zařízení nechává mrtvé odběry a aplikace pak tvrdí, že je odběr jinde.
            $this->db->run('DELETE FROM push_subscription WHERE user_id = ? AND device_id = ? AND endpoint_hash <> ?', [
                $identity->userId,
                $input['deviceId'],
                $endpointHash,
            ]);

            $this->db->run(
                'INSERT INTO push_subscription
                     (user_id, device_id, endpoint, endpoint_hash, p256dh, auth,
                      content_encoding, last_seen_at, failed_at)
                 VALUES (?, ?, ?, ?, ?, ?, ?, NOW(), NULL)
                 ON DUPLICATE KEY UPDATE
                     device_id = VALUES(device_id), p256dh = VALUES(p256dh), auth = VALUES(auth),
                     content_encoding = VALUES(content_encoding), last_seen_at = NOW(), failed_at = NULL',
                [
                    $identity->userId,
                    $input['deviceId'],
                    $input['endpoint'],
                    $endpointHash,
                    $input['p256dh'],
                    $input['auth'],
                    $input['contentEncoding'],
                ],
            );
        });
    }

    public function unsubscribe(Identity $identity, string $endpoint): void
    {
        if ($endpoint === '' || mb_strlen($endpoint) > 500) {
            throw ApiException::validation('Neplatný odběr oznámení.', ['field' => 'endpoint']);
        }

        $this->db->run('DELETE FROM push_subscription WHERE user_id = ? AND endpoint_hash = ? AND endpoint = ?', [
            $identity->userId,
            hash('sha256', $endpoint),
            $endpoint,
        ]);
    }

    public function removeAllSubscriptions(int $userId): void
    {
        $this->db->run('DELETE FROM push_subscription WHERE user_id = ?', [$userId]);
    }

    /**
     * @param  array<string,bool> $preferences
     * @return array<string,bool>
     */
    public function savePreferences(Identity $identity, array $preferences): array
    {
        if (array_keys($preferences) !== array_keys(self::PREFERENCES)) {
            throw ApiException::validation('Chybí některá volba oznámení.', ['field' => 'preferences']);
        }

        $this->db->transaction(function () use ($identity, $preferences): void {
            foreach (self::PREFERENCES as $key => $definition) {
                $enabled = $preferences[$key];
                $this->db->run(
                    "INSERT INTO notification_pref (user_id, event_type, channel, enabled)
                     VALUES (?, ?, 'push', ?)
                     ON DUPLICATE KEY UPDATE enabled = VALUES(enabled)",
                    [$identity->userId, $definition['type'], $enabled ? 1 : 0],
                );

                if (!$enabled) {
                    $this->db->run(
                        "DELETE q FROM notification_queue q
                          JOIN notification n ON n.id = q.notification_id
                         WHERE n.user_id = ? AND n.type = ? AND q.status IN ('pending','processing')",
                        [$identity->userId, $definition['type']],
                    );
                }
            }
        });

        return $this->preferences($identity->userId);
    }

    public function enqueueOffenceBatch(int $batchId): int
    {
        $rows = $this->db->all(
            'SELECT DISTINCT m.user_id
               FROM offence_record r
               JOIN membership m ON m.id = r.membership_id
              WHERE r.batch_id = ? AND r.voided_at IS NULL',
            [$batchId],
        );

        $created = 0;
        foreach ($rows as $row) {
            $created += $this->enqueue(
                (int) $row['user_id'],
                self::OFFENCE_BATCH,
                'Nový zápis do píny',
                'V píně máš nový zápis.',
                '/zapisy',
                'batch:' . $batchId,
            ) ? 1 : 0;
        }

        return $created;
    }

    /** Připomínky se zakládají před termínem, bez termínu zůstává večer před akcí. */
    public function enqueueEventReminders(?DateTimeImmutable $now = null): int
    {
        $local = ($now ?? new DateTimeImmutable('now', $this->timeZone))->setTimezone($this->timeZone);
        $hour  = (int) $local->format('G');
        if ($hour < self::QUIET_UNTIL_HOUR || $hour >= self::QUIET_FROM_HOUR) {
            return 0;
        }

        $nowSql             = $local->format('Y-m-d H:i:s');
        $tomorrow           = $local->modify('+1 day')->format('Y-m-d');
        $deadlineExpression = RsvpDeadline::sqlExpression();
        $rows               = $this->db->all(
            "SELECT candidates.event_id, candidates.user_id, candidates.rsvp_deadline_at
               FROM (
                    SELECT e.id AS event_id, e.starts_at, m.user_id,
                           $deadlineExpression AS rsvp_deadline_at
                      FROM event e
                      JOIN season s ON s.id = e.season_id
                      LEFT JOIN team_settings ts ON ts.team_id = s.team_id
                      JOIN roster_entry re ON re.season_id = s.id AND re.active = 1
                      JOIN membership m ON m.id = re.membership_id AND m.status = 'active'
                     LEFT JOIN event_participant ep ON ep.event_id = e.id AND ep.membership_id = m.id
                     WHERE e.starts_at > ? AND e.status = 'planned'
                       AND " . AttendanceModule::SQL_ENABLED . "
                       AND COALESCE(ep.rsvp, 'unknown') = 'unknown'
               ) AS candidates
              WHERE (candidates.rsvp_deadline_at IS NOT NULL
                     AND candidates.rsvp_deadline_at > ?
                     AND candidates.rsvp_deadline_at <= DATE_ADD(?, INTERVAL " . self::REMINDER_LEAD_HOURS . ' HOUR))
                 OR (candidates.rsvp_deadline_at IS NULL
                     AND ? >= ' . self::REMINDER_FROM_HOUR . '
                     AND DATE(candidates.starts_at) = ?)',
            [$nowSql, $nowSql, $nowSql, $hour, $tomorrow],
        );

        $created = 0;
        foreach ($rows as $row) {
            $eventId  = (int) $row['event_id'];
            $deadline = $row['rsvp_deadline_at'];
            $title    = $deadline === null ? 'Odpověz na zítřejší akci' : 'Blíží se termín zápisu na akci';
            $body     = $deadline === null
                ? 'V kalendáři pořád chybí tvoje odpověď.'
                : 'Odpověz do ' . $this->deadlineWording($local, (string) $deadline) . ', pak už to bude pozdní zápis.';
            $created += $this->enqueue(
                (int) $row['user_id'],
                self::EVENT_REMINDER,
                $title,
                $body,
                '/akce/' . $eventId,
                'event:' . $eventId,
            ) ? 1 : 0;
        }

        return $created;
    }

    /**
     * Samotné „do 18:00" je past: připomínka chodí až dvanáct hodin předem, takže
     * termín může padnout i na zítřejší ráno a hráč by četl čas, který dnes už
     * minul. Den se proto dopisuje všude, kde není dnešní.
     */
    private function deadlineWording(DateTimeImmutable $now, string $deadline): string
    {
        $at   = new DateTimeImmutable($deadline, $this->timeZone);
        $time = $at->format('H:i');
        $day  = $at->format('Y-m-d');

        if ($day === $now->format('Y-m-d')) {
            return $time;
        }

        // Dál než na zítřek se s dvanáctihodinovým předstihem dostat nedá,
        // ale datum je lepší pojistka než mlčky předpokládaný zítřek.
        return $day === $now->modify('+1 day')->format('Y-m-d')
            ? 'zítřejších ' . $time
            : $at->format('j. n.') . ' ' . $time;
    }

    /**
     * @return array{claimed:int,sent:int,expired:int,retried:int,failed:int,deferred:int,suppressed:bool}
     */
    public function flush(?DateTimeImmutable $now = null, int $limit = 50, ?float $budgetSeconds = null): array
    {
        $local = ($now ?? new DateTimeImmutable('now', $this->timeZone))->setTimezone($this->timeZone);
        $hour  = (int) $local->format('G');
        $empty = ['claimed' => 0, 'sent' => 0, 'expired' => 0, 'retried' => 0, 'failed' => 0, 'deferred' => 0];

        if ($hour < self::QUIET_UNTIL_HOUR || $hour >= self::QUIET_FROM_HOUR) {
            return [...$empty, 'suppressed' => true];
        }

        $items    = $this->claim($local, max(1, min($limit, 200)));
        $result   = [...$empty, 'claimed' => count($items), 'suppressed' => false];
        $deadline = microtime(true) + ($budgetSeconds ?? self::BUDGET_SECONDS);

        foreach ($items as $index => $item) {
            $queueId = (int) $item['queue_id'];
            $type    = (string) $item['type'];
            $userId  = (int) $item['user_id'];

            if (microtime(true) >= $deadline) {
                $result['deferred'] = $this->release(array_slice($items, $index));

                break;
            }

            if (!$this->preferenceEnabled($userId, $type)) {
                $this->finishFailed($queueId, 'Tahle kategorie je vypnutá.');
                $result['failed']++;

                continue;
            }

            try {
                $delivery = $this->push->deliver(
                    [
                        'endpoint'        => (string) $item['endpoint'],
                        'p256dh'          => (string) $item['p256dh'],
                        'auth'            => (string) $item['auth'],
                        'contentEncoding' => (string) $item['content_encoding'],
                    ],
                    [
                        'title' => (string) $item['title'],
                        'body'  => (string) $item['body'],
                        'link'  => $item['link'] === null ? '/' : (string) $item['link'],
                    ],
                );
            } catch (Throwable $error) {
                $delivery = PushDelivery::failed($error->getMessage());
            }

            if ($delivery->success) {
                $this->db->run(
                    "UPDATE notification_queue SET status = 'sent', sent_at = ?, attempts = attempts + 1,
                            locked_at = NULL, last_error = NULL WHERE id = ? AND status = 'processing'",
                    [$local->format('Y-m-d H:i:s'), $queueId],
                );
                $result['sent']++;
            } elseif ($delivery->expired) {
                $this->db->run('DELETE FROM push_subscription WHERE id = ?', [(int) $item['subscription_id']]);
                $result['expired']++;
            } else {
                $attempts = (int) $item['attempts'] + 1;
                if ($attempts >= self::MAX_ATTEMPTS) {
                    $this->finishFailed($queueId, $delivery->reason, $attempts);
                    $result['failed']++;
                } else {
                    $delay = min(3600, 60 * (2 ** ($attempts - 1)));
                    $this->db->run(
                        "UPDATE notification_queue
                            SET status = 'pending', attempts = ?, last_error = ?, send_after = ?, locked_at = NULL
                          WHERE id = ? AND status = 'processing'",
                        [
                            $attempts,
                            mb_substr($delivery->reason, 0, 255),
                            $local->modify("+$delay seconds")->format('Y-m-d H:i:s'),
                            $queueId,
                        ],
                    );
                    $result['retried']++;
                }
            }
        }

        return $result;
    }

    /** @return array<string,bool> */
    private function preferences(int $userId): array
    {
        $rows = $this->db->all(
            "SELECT event_type, enabled FROM notification_pref WHERE user_id = ? AND channel = 'push'",
            [$userId],
        );
        $overrides = [];
        foreach ($rows as $row) {
            $overrides[(string) $row['event_type']] = (bool) $row['enabled'];
        }

        $result = [];
        foreach (self::PREFERENCES as $key => $definition) {
            $result[$key] = $overrides[$definition['type']] ?? $definition['default'];
        }

        return $result;
    }

    private function preferenceEnabled(int $userId, string $type): bool
    {
        foreach (self::PREFERENCES as $definition) {
            if ($definition['type'] !== $type) {
                continue;
            }

            $stored = $this->db->value(
                "SELECT enabled FROM notification_pref WHERE user_id = ? AND event_type = ? AND channel = 'push'",
                [$userId, $type],
            );

            return $stored === null ? $definition['default'] : (bool) $stored;
        }

        return false;
    }

    private function enqueue(
        int $userId,
        string $type,
        string $title,
        string $body,
        string $link,
        string $dedupeKey,
    ): bool {
        $insert = $this->db->run(
            'INSERT IGNORE INTO notification (user_id, type, title, body, link, dedupe_key)
             VALUES (?, ?, ?, ?, ?, ?)',
            [$userId, $type, $title, $body, $link, $dedupeKey],
        );

        if ($insert->rowCount() === 0) {
            return false;
        }

        $notificationId = $this->db->lastInsertId();
        if ($this->preferenceEnabled($userId, $type)) {
            $this->db->run(
                'INSERT IGNORE INTO notification_queue (notification_id, push_subscription_id)
                 SELECT ?, ps.id FROM push_subscription ps
                  WHERE ps.user_id = ? AND ps.failed_at IS NULL',
                [$notificationId, $userId],
            );
        }

        return true;
    }

    /** @return list<array<string,mixed>> */
    private function claim(DateTimeImmutable $now, int $limit): array
    {
        return $this->db->transaction(function () use ($now, $limit): array {
            $this->db->run(
                "UPDATE notification_queue SET status = 'pending', locked_at = NULL
                  WHERE status = 'processing' AND locked_at < ?",
                [$now->modify('-10 minutes')->format('Y-m-d H:i:s')],
            );

            $ids = $this->db->all(
                "SELECT id FROM notification_queue
                  WHERE status = 'pending' AND send_after <= ?
                  ORDER BY id LIMIT ? FOR UPDATE SKIP LOCKED",
                [$now->format('Y-m-d H:i:s'), $limit],
            );
            if ($ids === []) {
                return [];
            }

            $queueIds     = array_map(static fn (array $row): int => (int) $row['id'], $ids);
            $placeholders = implode(',', array_fill(0, count($queueIds), '?'));
            $this->db->run(
                "UPDATE notification_queue SET status = 'processing', locked_at = ? WHERE id IN ($placeholders)",
                [$now->format('Y-m-d H:i:s'), ...$queueIds],
            );

            return $this->db->all(
                "SELECT q.id AS queue_id, q.attempts, n.user_id, n.type, n.title, n.body, n.link,
                        ps.id AS subscription_id, ps.endpoint, ps.p256dh, ps.auth, ps.content_encoding
                   FROM notification_queue q
                   JOIN notification n ON n.id = q.notification_id
                   JOIN push_subscription ps ON ps.id = q.push_subscription_id AND ps.user_id = n.user_id
                  WHERE q.id IN ($placeholders)
                  ORDER BY q.id",
                $queueIds,
            );
        });
    }

    /**
     * Vrátí nezpracované položky do fronty bez navýšení pokusů — nejde o selhání
     * doručení, jen o konec vyhrazeného času.
     *
     * @param  list<array<string,mixed>> $items
     * @return int                       počet vrácených položek
     */
    private function release(array $items): int
    {
        if ($items === []) {
            return 0;
        }

        $queueIds     = array_map(static fn (array $item): int => (int) $item['queue_id'], $items);
        $placeholders = implode(',', array_fill(0, count($queueIds), '?'));

        return $this->db->run(
            "UPDATE notification_queue SET status = 'pending', locked_at = NULL
              WHERE id IN ($placeholders) AND status = 'processing'",
            $queueIds,
        )->rowCount();
    }

    private function finishFailed(int $queueId, string $reason, ?int $attempts = null): void
    {
        $sql    = "UPDATE notification_queue SET status = 'failed', last_error = ?, locked_at = NULL";
        $params = [mb_substr($reason, 0, 255)];
        if ($attempts !== null) {
            $sql .= ', attempts = ?';
            $params[] = $attempts;
        }
        $sql .= " WHERE id = ? AND status = 'processing'";
        $params[] = $queueId;
        $this->db->run($sql, $params);
    }

    /** @param array{endpoint:string,p256dh:string,auth:string,contentEncoding:string,deviceId:string} $input */
    private function assertSubscription(array $input): void
    {
        $url    = parse_url($input['endpoint']);
        $scheme = is_array($url) ? ($url['scheme'] ?? null) : null;
        if ($scheme !== 'https' || mb_strlen($input['endpoint']) > 500) {
            throw ApiException::validation('Neplatná adresa odběru oznámení.', ['field' => 'endpoint']);
        }

        if (preg_match('/^[a-f0-9]{32}$/', $input['deviceId']) !== 1) {
            throw ApiException::validation('Neplatný identifikátor zařízení.', ['field' => 'deviceId']);
        }

        foreach (['p256dh', 'auth'] as $key) {
            $value = $input[$key];
            if ($value === '' || mb_strlen($value) > 255 || preg_match('/^[A-Za-z0-9_-]+$/', $value) !== 1) {
                throw ApiException::validation('Neplatný klíč odběru oznámení.', ['field' => $key]);
            }
        }

        if (!in_array($input['contentEncoding'], ['aes128gcm', 'aesgcm'], true)) {
            throw ApiException::validation('Nepodporované šifrování oznámení.', ['field' => 'contentEncoding']);
        }
    }
}
