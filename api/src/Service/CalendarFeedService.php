<?php

declare(strict_types=1);

namespace Pina\Service;

use Pina\Auth\Identity;
use Pina\Auth\Role;
use Pina\Auth\TeamScope;
use Pina\Http\ApiException;
use Pina\Support\Database;
use Pina\Support\IcsCalendar;

/**
 * Odběr kalendáře. Veřejná adresa je přístupový údaj, proto se token
 * vrací jen při vydání a v databázi zůstává pouze jeho otisk.
 *
 * @phpstan-import-type CalendarEvent from IcsCalendar
 * @phpstan-type FeedPayload array{
 *     id:int,
 *     teamId:int,
 *     teamName:string,
 *     seasonId:int,
 *     seasonName:string,
 *     createdAt:string,
 *     lastUsedAt:string|null
 * }
 * @phpstan-type IssuedFeed array{
 *     id:int,
 *     teamId:int,
 *     teamName:string,
 *     seasonId:int,
 *     seasonName:string,
 *     createdAt:string,
 *     lastUsedAt:string|null,
 *     token:string
 * }
 * @phpstan-type FeedDocument array{body:string,etag:string,notModified:bool}
 */
final class CalendarFeedService
{
    private const MIN_FULL_FETCH_SECONDS = 2;

    public function __construct(
        private readonly Database $db,
        private readonly TeamScope $scope,
        private readonly IcsCalendar $ics,
    ) {
    }

    /**
     * Vlastní odběry jsou omezené `user_id` a živým členstvím stejně jako
     * seznam vlastních družstev; cizí záznam se do výsledku nemůže dostat.
     *
     * @return list<FeedPayload>
     */
    public function list(Identity $identity): array
    {
        $rows = $this->db->all(
            "SELECT cf.id, cf.team_id, t.name AS team_name, cf.season_id, s.name AS season_name,
                    cf.created_at, cf.last_used_at
               FROM calendar_feed cf
               JOIN team t ON t.id = cf.team_id
               JOIN season s ON s.id = cf.season_id AND s.team_id = cf.team_id
               JOIN membership m ON m.user_id = cf.user_id AND m.team_id = cf.team_id
                                  AND m.status <> 'left'
              WHERE cf.user_id = ? AND cf.revoked_at IS NULL
              ORDER BY t.name, s.starts_on DESC, cf.id",
            [$identity->userId],
        );

        return array_map(fn (array $row): array => $this->mapFeed($row), $rows);
    }

    /** @return IssuedFeed */
    public function issue(Identity $identity, int $seasonId): array
    {
        $teamId = $this->scope->season($identity, $seasonId, Role::Player);

        $membershipId = $this->db->value(
            "SELECT id FROM membership
              WHERE user_id = ? AND team_id = ? AND status <> 'left'",
            [$identity->userId, $teamId],
        );

        // Správce platformy bez skutečného členství odběr založit nesmí.
        if ($membershipId === null) {
            throw ApiException::notFound();
        }

        $token = bin2hex(random_bytes(32));

        /** @var FeedPayload $feed */
        $feed = $this->db->transaction(function () use ($identity, $teamId, $seasonId, $membershipId, $token): array {
            // Zámek členství serializuje dva souběžné pokusy o vydání.
            $this->db->value('SELECT id FROM membership WHERE id = ? FOR UPDATE', [$membershipId]);

            $this->db->run(
                'UPDATE calendar_feed SET revoked_at = NOW()
                  WHERE user_id = ? AND season_id = ? AND revoked_at IS NULL',
                [$identity->userId, $seasonId],
            );

            $this->db->run(
                'INSERT INTO calendar_feed (user_id, team_id, season_id, token_hash)
                 VALUES (?, ?, ?, ?)',
                [$identity->userId, $teamId, $seasonId, hash('sha256', $token)],
            );

            $row = $this->feedRow($this->db->lastInsertId(), $identity->userId);
            if ($row === null) {
                throw ApiException::notFound();
            }

            return $this->mapFeed($row);
        });

        return [...$feed, 'token' => $token];
    }

    public function revoke(Identity $identity, int $feedId): void
    {
        $row = $this->feedRow($feedId, $identity->userId);
        if ($row === null || $row['revoked_at'] !== null) {
            throw ApiException::notFound();
        }

        $this->scope->season($identity, (int) $row['season_id'], Role::Player);

        $this->db->run(
            'UPDATE calendar_feed SET revoked_at = NOW()
              WHERE id = ? AND user_id = ? AND revoked_at IS NULL',
            [$feedId, $identity->userId],
        );
    }

    /** @return FeedDocument */
    public function document(string $token, ?string $ifNoneMatch): array
    {
        $feed = $this->db->first(
            "SELECT cf.id, cf.season_id, t.name AS team_name, s.name AS season_name
               FROM calendar_feed cf
               JOIN team t ON t.id = cf.team_id
               JOIN season s ON s.id = cf.season_id AND s.team_id = cf.team_id
               JOIN membership m ON m.user_id = cf.user_id AND m.team_id = cf.team_id
                                  AND m.status <> 'left'
              WHERE cf.token_hash = ? AND cf.revoked_at IS NULL",
            [hash('sha256', $token)],
        );

        if ($feed === null) {
            throw ApiException::notFound();
        }

        // Jediný atomický UPDATE zavře i dva souběžné požadavky. Kontrola je
        // před skládáním ICS, takže limit nejde obejít hlavičkou If-None-Match.
        $accepted = $this->db->run(
            'UPDATE calendar_feed SET last_used_at = NOW()
              WHERE id = ? AND (last_used_at IS NULL OR last_used_at <= DATE_SUB(NOW(), INTERVAL ? SECOND))',
            [$feed['id'], self::MIN_FULL_FETCH_SECONDS],
        )->rowCount() === 1;

        if (!$accepted) {
            throw ApiException::tooManyRequests(
                'Kalendář se načítá příliš často. Zkuste to za chvíli znovu.',
                self::MIN_FULL_FETCH_SECONDS,
            );
        }

        $events = $this->calendarEvents((int) $feed['season_id']);
        $body   = $this->ics->build($events, (string) $feed['team_name'], (string) $feed['season_name']);
        $etag   = '"' . hash('sha256', $body) . '"';

        $notModified = $this->etagMatches($ifNoneMatch, $etag);

        return ['body' => $body, 'etag' => $etag, 'notModified' => $notModified];
    }

    /** @return list<CalendarEvent> */
    private function calendarEvents(int $seasonId): array
    {
        $rows = $this->db->all(
            'SELECT e.id, e.title, e.starts_at, e.ends_at, e.meet_at, e.opponent,
                    e.status, e.created_at, l.name AS location_name, l.address AS location_address
               FROM event e
               LEFT JOIN location l ON l.id = e.location_id
              WHERE e.season_id = ?
              ORDER BY e.starts_at, e.id',
            [$seasonId],
        );

        return array_map(static fn (array $row): array => [
            'id'              => (int) $row['id'],
            'title'           => (string) $row['title'],
            'startsAt'        => (string) $row['starts_at'],
            'endsAt'          => $row['ends_at'] === null ? null : (string) $row['ends_at'],
            'meetAt'          => $row['meet_at'] === null ? null : (string) $row['meet_at'],
            'locationName'    => $row['location_name'] === null ? null : (string) $row['location_name'],
            'locationAddress' => $row['location_address'] === null ? null : (string) $row['location_address'],
            'opponent'        => $row['opponent'] === null ? null : (string) $row['opponent'],
            'status'          => (string) $row['status'],
            'createdAt'       => (string) $row['created_at'],
        ], $rows);
    }

    /** @return array<string,mixed>|null */
    private function feedRow(int $feedId, int $userId): ?array
    {
        return $this->db->first(
            'SELECT cf.id, cf.team_id, t.name AS team_name, cf.season_id, s.name AS season_name,
                    cf.created_at, cf.last_used_at, cf.revoked_at
               FROM calendar_feed cf
               JOIN team t ON t.id = cf.team_id
               JOIN season s ON s.id = cf.season_id AND s.team_id = cf.team_id
              WHERE cf.id = ? AND cf.user_id = ?',
            [$feedId, $userId],
        );
    }

    /**
     * @param  array<string,mixed> $row
     * @return FeedPayload
     */
    private function mapFeed(array $row): array
    {
        return [
            'id'         => (int) $row['id'],
            'teamId'     => (int) $row['team_id'],
            'teamName'   => (string) $row['team_name'],
            'seasonId'   => (int) $row['season_id'],
            'seasonName' => (string) $row['season_name'],
            'createdAt'  => (string) $row['created_at'],
            'lastUsedAt' => $row['last_used_at'] === null ? null : (string) $row['last_used_at'],
        ];
    }

    private function etagMatches(?string $header, string $etag): bool
    {
        if ($header === null) {
            return false;
        }

        $values = array_map('trim', explode(',', $header));

        return in_array('*', $values, true) || in_array($etag, $values, true);
    }
}
