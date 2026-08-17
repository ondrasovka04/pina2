<?php

declare(strict_types=1);

namespace Pina\Service;

use Pina\Auth\Identity;
use Pina\Auth\Role;
use Pina\Auth\TeamScope;
use Pina\Http\ApiException;
use Pina\Support\Database;
use Pina\Support\Recurrence;

/**
 * Akce (tréninky, zápasy) a docházka.
 *
 * `event_participant.attendance` je jen ruční oprava, ne docházka sama — ta se
 * odvozuje z RSVP (COALESCE(oprava, odvození)). Tým odmítl odklikávat celý tým
 * po každém tréninku. Proto taky RSVP jde měnit jen do začátku akce, jinak by
 * si hráč přepsal vlastní docházku.
 *
 * @phpstan-type LocationPayload array{
 *     id:int,
 *     name:string,
 *     address:string|null,
 *     lat:float|null,
 *     lng:float|null,
 *     note:string|null
 * }
 * @phpstan-type MyParticipation array{
 *     membershipId:int,
 *     rsvp:string,
 *     rsvpNote:string|null,
 *     nomination:string,
 *     transport:string,
 *     carSeats:int|null,
 *     attendance:string|null
 * }
 * @phpstan-type EventPayload array{
 *     id:int,
 *     seasonId:int,
 *     seriesId:int|null,
 *     type:string,
 *     title:string,
 *     startsAt:string,
 *     endsAt:string|null,
 *     meetAt:string|null,
 *     location:LocationPayload|null,
 *     opponent:string|null,
 *     note:string|null,
 *     distanceKm:int|null,
 *     nominationDeadline:string|null,
 *     status:string,
 *     isHome:bool|null,
 *     overridden:bool,
 *     started:bool,
 *     rosterCount:int,
 *     counts:array{yes:int,no:int,unknown:int},
 *     me:MyParticipation|null
 * }
 * @phpstan-type ParticipantPayload array{
 *     membershipId:int,
 *     userId:int,
 *     name:string,
 *     jerseyNumber:int|null,
 *     onRoster:bool,
 *     nomination:string,
 *     rsvp:string,
 *     rsvpNote:string|null,
 *     transport:string,
 *     carSeats:int|null,
 *     attendance:string|null,
 *     corrected:bool
 * }
 * @phpstan-type EventDetail array{
 *     event:EventPayload,
 *     participants:list<ParticipantPayload>,
 *     canSeeAttendance:bool
 * }
 * @phpstan-type SeriesPayload array{
 *     id:int,
 *     seasonId:int,
 *     title:string,
 *     type:string,
 *     rrule:string,
 *     startTime:string,
 *     durationMin:int,
 *     location:LocationPayload|null,
 *     meetBeforeMin:int|null,
 *     defaultNote:string|null,
 *     activeFrom:string,
 *     activeTo:string,
 *     eventCount:int
 * }
 * @phpstan-type AttendanceRow array{
 *     membershipId:int,
 *     userId:int,
 *     name:string,
 *     jerseyNumber:int|null,
 *     present:int,
 *     absent:int,
 *     injured:int,
 *     total:int,
 *     ratio:float|null
 * }
 */
final class EventService
{
    public const TYPES = ['training', 'match', 'other'];

    public const RSVP_VALUES = ['unknown', 'yes', 'no'];

    public const ATTENDANCE_VALUES = ['present', 'absent', 'injured'];

    public const NOMINATIONS = ['none', 'nominated', 'substitute'];

    /** Beru auto, nebo neberu. Víc stavů nemá následek, takže se nenabízejí. */
    public const TRANSPORT_VALUES = ['none', 'driver'];

    /** Rozsah hromadné změny série. Jeden termín se upravuje přes update(). */
    public const SCOPES = ['following', 'all'];

    /** Pojistka proti pravidlu, které by vyrobilo tisíce termínů. */
    private const MAX_SERIES_EVENTS = 300;

    public function __construct(
        private readonly Database $db,
        private readonly TeamScope $scope,
    ) {
    }

    /**
     * Kalendář sezóny. Bez omezení vrací celou sezónu — termínů je řádově sto.
     *
     * @return list<EventPayload>
     */
    public function calendar(Identity $identity, int $seasonId, ?string $from, ?string $to): array
    {
        $teamId = $this->scope->season($identity, $seasonId, Role::Player);

        $conditions = ['e.season_id = ?'];
        $params     = [$seasonId];

        if ($from !== null) {
            $conditions[] = 'e.starts_at >= ?';
            $params[]     = $from . ' 00:00:00';
        }

        if ($to !== null) {
            $conditions[] = 'e.starts_at <= ?';
            $params[]     = $to . ' 23:59:59';
        }

        $where = implode(' AND ', $conditions);

        $rows = $this->db->all(
            $this->eventSelect() . " WHERE $where ORDER BY e.starts_at, e.id",
            [$seasonId, $identity->userId, ...$params],
        );

        $rosterCount = $this->rosterCount($seasonId);

        return array_map(fn (array $row): array => $this->mapEvent($row, $rosterCount), $rows);
    }

    /**
     * Detail akce i s tím, kdo přijde.
     *
     * Kdo dorazí, vidí celý tým kvůli odvozům. Skutečnou docházku ostatních vidí
     * jen pínař a admin, hráčům ji otevře přepínač `attendance_visible_to_players` —
     * docházka je citlivější než dluhy.
     *
     * @return EventDetail
     */
    public function detail(Identity $identity, int $eventId): array
    {
        $teamId = $this->scope->event($identity, $eventId, Role::Player);

        $row = $this->db->first(
            $this->eventSelect() . ' WHERE e.id = ?',
            [$this->seasonOf($eventId), $identity->userId, $eventId],
        );

        if ($row === null) {
            throw ApiException::notFound();
        }

        $seasonId    = (int) $row['season_id'];
        $rosterCount = $this->rosterCount($seasonId);
        $event       = $this->mapEvent($row, $rosterCount);

        $canSeeAttendance = $this->managesTeam($identity, $teamId) || $this->attendanceVisibleToPlayers($teamId);
        $myMembershipId   = $event['me']['membershipId'] ?? null;

        return [
            'event'            => $event,
            'participants'     => $this->participants($eventId, $seasonId, $teamId, $canSeeAttendance, $myMembershipId),
            'canSeeAttendance' => $canSeeAttendance,
        ];
    }

    /**
     * @param  array{
     *     type:string,
     *     title:string,
     *     startsAt:string,
     *     endsAt:string|null,
     *     meetAt:string|null,
     *     locationId:int|null,
     *     opponent:string|null,
     *     note:string|null,
     *     distanceKm:int|null,
     *     nominationDeadline:string|null
     * } $input
     * @return EventPayload
     */
    public function create(Identity $identity, int $seasonId, array $input): array
    {
        $teamId = $this->scope->writableSeason($identity, $seasonId, Role::Admin);

        $this->assertType($input['type']);
        $this->assertLocation($input['locationId'], $teamId);
        $this->assertTimes($input['startsAt'], $input['endsAt'], $input['meetAt']);

        $this->db->run(
            'INSERT INTO event
                 (season_id, type, title, starts_at, ends_at, meet_at, location_id,
                  opponent, note, distance_km, nomination_deadline)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
            [
                $seasonId,
                $input['type'],
                $input['title'],
                $input['startsAt'],
                $input['endsAt'],
                $input['meetAt'],
                $input['locationId'],
                $input['opponent'],
                $input['note'],
                $this->distanceFor($teamId, $input['type'], $input['locationId'], $input['distanceKm']),
                $input['nominationDeadline'],
            ],
        );

        return $this->eventPayload($identity, $this->db->lastInsertId());
    }

    /**
     * Úprava jednoho termínu. U termínu ze série se tím nastaví `overridden`,
     * aby ho přegenerování série nepřepsalo zpátky.
     *
     * @param  array<string,mixed> $changes
     * @return EventPayload
     */
    public function update(Identity $identity, int $eventId, array $changes): array
    {
        $teamId = $this->scope->event($identity, $eventId, Role::Admin);
        $this->assertOpenSeason($eventId);

        if ($changes === []) {
            throw ApiException::validation('Není co upravit — pošlete alespoň jedno pole.');
        }

        $current = $this->db->first(
            'SELECT type, title, starts_at, ends_at, meet_at, location_id, opponent, note,
                    distance_km, nomination_deadline, status, series_id
               FROM event WHERE id = ?',
            [$eventId],
        );

        if ($current === null) {
            throw ApiException::notFound();
        }

        $type     = $this->pickString($changes, 'type', (string) $current['type']);
        $title    = $this->pickString($changes, 'title', (string) $current['title']);
        $startsAt = $this->pickString($changes, 'startsAt', (string) $current['starts_at']);
        $status   = $this->pickString($changes, 'status', (string) $current['status']);

        $endsAt     = $this->pickNullableString($changes, 'endsAt', $current['ends_at']);
        $meetAt     = $this->pickNullableString($changes, 'meetAt', $current['meet_at']);
        $opponent   = $this->pickNullableString($changes, 'opponent', $current['opponent']);
        $note       = $this->pickNullableString($changes, 'note', $current['note']);
        $locationId = $this->pickNullableInt($changes, 'locationId', $current['location_id']);
        $distanceKm = $this->pickNullableInt($changes, 'distanceKm', $current['distance_km']);
        $deadline   = $this->pickNullableString($changes, 'nominationDeadline', $current['nomination_deadline']);

        $this->assertType($type);
        $this->assertLocation($locationId, $teamId);
        $this->assertTimes($startsAt, $endsAt, $meetAt);

        if (!in_array($status, ['planned', 'cancelled', 'done'], true)) {
            throw ApiException::validation('Neznámý stav akce.', ['field' => 'status']);
        }

        $this->db->run(
            'UPDATE event
                SET type = ?, title = ?, starts_at = ?, ends_at = ?, meet_at = ?, location_id = ?,
                    opponent = ?, note = ?, distance_km = ?, nomination_deadline = ?, status = ?,
                    overridden = CASE WHEN series_id IS NULL THEN 0 ELSE 1 END
              WHERE id = ?',
            [
                $type,
                $title,
                $startsAt,
                $endsAt,
                $meetAt,
                $locationId,
                $opponent,
                $note,
                $this->distanceFor($teamId, $type, $locationId, $distanceKm),
                $deadline,
                $status,
                $eventId,
            ],
        );

        return $this->eventPayload($identity, $eventId);
    }

    /**
     * Zrušená akce se nemaže — nese odpovědi hráčů a případné prohřešky.
     *
     * @return EventPayload
     */
    public function cancel(Identity $identity, int $eventId): array
    {
        $this->scope->event($identity, $eventId, Role::Admin);
        $this->assertOpenSeason($eventId);

        $this->db->run("UPDATE event SET status = 'cancelled' WHERE id = ?", [$eventId]);

        return $this->eventPayload($identity, $eventId);
    }

    /**
     * @return EventPayload
     */
    public function restore(Identity $identity, int $eventId): array
    {
        $this->scope->event($identity, $eventId, Role::Admin);
        $this->assertOpenSeason($eventId);

        $this->db->run("UPDATE event SET status = 'planned' WHERE id = ?", [$eventId]);

        return $this->eventPayload($identity, $eventId);
    }

    /**
     * Maže akci i s odpověďmi a docházkou — na rozdíl od zrušení, které nechá
     * cedulí v kalendáři. Smazání je pro akci, co tam neměla vůbec být.
     * Prohřešky přežijí, vazba na akci je ON DELETE SET NULL.
     */
    public function delete(Identity $identity, int $eventId): void
    {
        $this->scope->event($identity, $eventId, Role::Admin);
        $this->assertOpenSeason($eventId);

        $this->db->run('DELETE FROM event WHERE id = ?', [$eventId]);
    }

    /**
     * @return list<SeriesPayload>
     */
    public function series(Identity $identity, int $seasonId): array
    {
        $this->scope->season($identity, $seasonId, Role::Player);

        $rows = $this->db->all(
            'SELECT s.*, l.id AS loc_id, l.name AS loc_name, l.address AS loc_address,
                    l.lat AS loc_lat, l.lng AS loc_lng, l.note AS loc_note,
                    (SELECT COUNT(*) FROM event e WHERE e.series_id = s.id) AS event_count
               FROM event_series s
               LEFT JOIN location l ON l.id = s.location_id
              WHERE s.season_id = ?
              ORDER BY s.active_from, s.id',
            [$seasonId],
        );

        return array_map($this->mapSeries(...), $rows);
    }

    /**
     * Založí opakovanou akci a rovnou vyrobí všechny termíny — sezóna sérii
     * ohraničuje, takže termínů je jen pár desítek. Žádné klouzavé okno ani
     * plánovaná úloha, co by je dogenerovávala později.
     *
     * @param  array{
     *     title:string,
     *     type:string,
     *     rrule:string,
     *     startTime:string,
     *     durationMin:int,
     *     locationId:int|null,
     *     meetBeforeMin:int|null,
     *     defaultNote:string|null,
     *     activeFrom:string,
     *     activeTo:string
     * } $input
     * @return array{series:SeriesPayload,created:int,skipped:int}
     */
    public function createSeries(Identity $identity, int $seasonId, array $input): array
    {
        $teamId = $this->scope->writableSeason($identity, $seasonId, Role::Admin);

        $this->assertType($input['type']);
        $this->assertLocation($input['locationId'], $teamId);

        $season = $this->db->first('SELECT starts_on, ends_on FROM season WHERE id = ?', [$seasonId]);

        if ($season === null) {
            throw ApiException::notFound();
        }

        // Série nesmí přetéct mimo sezónu — sazebník, docházka i soupiska jsou její.
        $from = max($input['activeFrom'], (string) $season['starts_on']);
        $to   = min($input['activeTo'], (string) $season['ends_on']);

        if ($from > $to) {
            throw ApiException::validation(
                'Období série musí zasahovat do sezóny.',
                ['field' => 'activeFrom'],
            );
        }

        $dates = Recurrence::dates($input['rrule'], $from, $to, self::MAX_SERIES_EVENTS);

        if ($dates === []) {
            throw ApiException::validation(
                'Pravidlo v tomhle období nevyrobí ani jeden termín.',
                ['field' => 'rrule'],
            );
        }

        $result = $this->db->transaction(function () use ($seasonId, $input, $from, $to, $dates): array {
            $seriesId = $this->insertSeries($seasonId, $input, $from, $to);
            $created  = 0;
            $skipped  = 0;

            foreach ($dates as $date) {
                $startsAt = $date . ' ' . $input['startTime'] . ':00';

                // Dvakrát založená stejná série by jinak zdvojila celý kalendář.
                $clash = $this->db->value(
                    'SELECT id FROM event WHERE season_id = ? AND starts_at = ? AND title = ?',
                    [$seasonId, $startsAt, $input['title']],
                );

                if ($clash !== null) {
                    $skipped++;

                    continue;
                }

                $this->insertEvent($seasonId, $seriesId, $input, $startsAt);
                $created++;
            }

            return ['seriesId' => $seriesId, 'created' => $created, 'skipped' => $skipped];
        });

        $series = $this->seriesPayload($result['seriesId']);

        return ['series' => $series, 'created' => $result['created'], 'skipped' => $result['skipped']];
    }

    /**
     * @param array{
     *     title:string,type:string,rrule:string,startTime:string,durationMin:int,
     *     locationId:int|null,meetBeforeMin:int|null,defaultNote:string|null
     * } $input
     */
    private function insertSeries(int $seasonId, array $input, string $from, string $to): int
    {
        $this->db->run(
            'INSERT INTO event_series
                 (season_id, title, type, rrule, start_time, duration_min, location_id,
                  meet_before_min, default_note, active_from, active_to)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
            [
                $seasonId,
                $input['title'],
                $input['type'],
                $input['rrule'],
                $input['startTime'] . ':00',
                $input['durationMin'],
                $input['locationId'],
                $input['meetBeforeMin'],
                $input['defaultNote'],
                $from,
                $to,
            ],
        );

        return $this->db->lastInsertId();
    }

    /**
     * Konec i čas srazu se počítají v databázi z délky a předstihu — o půlnoci
     * a při přechodu na letní čas to vyjde bez ručního počítání.
     *
     * @param array{
     *     type:string,title:string,durationMin:int,
     *     locationId:int|null,meetBeforeMin:int|null,defaultNote:string|null
     * } $input
     */
    private function insertEvent(int $seasonId, int $seriesId, array $input, string $startsAt): void
    {
        $this->db->run(
            'INSERT INTO event
                 (season_id, series_id, type, title, starts_at, ends_at, meet_at, location_id, note)
             VALUES (?, ?, ?, ?, ?,
                     DATE_ADD(?, INTERVAL ? MINUTE),
                     CASE WHEN ? IS NULL THEN NULL ELSE DATE_SUB(?, INTERVAL ? MINUTE) END,
                     ?, ?)',
            [
                $seasonId,
                $seriesId,
                $input['type'],
                $input['title'],
                $startsAt,
                $startsAt,
                $input['durationMin'],
                $input['meetBeforeMin'],
                $startsAt,
                $input['meetBeforeMin'],
                $input['locationId'],
                $input['defaultNote'],
            ],
        );
    }

    /**
     * Úprava opakované akce v zadaném rozsahu.
     *
     * `following` sérii **rozštěpí** — původní skončí den před hranicí, od ní
     * platí nová, takže stará dál popisuje, jak se hrálo předtím. `all` přepíše
     * celou sérii včetně minulých termínů. Co zůstane na stejném datu, se jen
     * upraví, aby odpovědi a docházka nezmizely — maže a zakládá se jen to,
     * co se posunulo.
     *
     * @param  array{
     *     title:string,
     *     type:string,
     *     rrule:string,
     *     startTime:string,
     *     durationMin:int,
     *     locationId:int|null,
     *     meetBeforeMin:int|null,
     *     defaultNote:string|null,
     *     activeTo:string
     * } $input
     * @return array{series:SeriesPayload,updated:int,created:int,deleted:int,skipped:int}
     */
    public function updateSeries(
        Identity $identity,
        int $seriesId,
        array $input,
        string $scope,
        ?int $fromEventId,
    ): array {
        $series = $this->seriesRow($seriesId);
        $teamId = $this->scope->writableSeason($identity, (int) $series['season_id'], Role::Admin);

        $this->assertScope($scope);
        $this->assertType($input['type']);
        $this->assertLocation($input['locationId'], $teamId);

        $seasonId = (int) $series['season_id'];
        $from     = $this->boundary($series, $scope, $fromEventId);

        $season = $this->db->first('SELECT starts_on, ends_on FROM season WHERE id = ?', [$seasonId]);

        if ($season === null) {
            throw ApiException::notFound();
        }

        $to = min($input['activeTo'], (string) $season['ends_on']);

        if ($from > $to) {
            throw ApiException::validation('Období série musí zasahovat do sezóny.', ['field' => 'activeTo']);
        }

        $dates = Recurrence::dates($input['rrule'], $from, $to, self::MAX_SERIES_EVENTS);

        if ($dates === []) {
            throw ApiException::validation(
                'Pravidlo v tomhle období nevyrobí ani jeden termín.',
                ['field' => 'rrule'],
            );
        }

        return $this->db->transaction(
            fn (): array => $this->rewriteSeries($series, $input, $scope, $from, $to, $dates),
        );
    }

    /**
     * @param  array<string,mixed> $series
     * @param  array{
     *     title:string,
     *     type:string,
     *     rrule:string,
     *     startTime:string,
     *     durationMin:int,
     *     locationId:int|null,
     *     meetBeforeMin:int|null,
     *     defaultNote:string|null,
     *     activeTo:string
     * } $input
     * @param  list<string> $dates
     * @return array{series:SeriesPayload,updated:int,created:int,deleted:int,skipped:int}
     */
    private function rewriteSeries(
        array $series,
        array $input,
        string $scope,
        string $from,
        string $to,
        array $dates,
    ): array {
        $seasonId = (int) $series['season_id'];
        $oldId    = (int) $series['id'];

        // Ručně upravený termín je vědomé rozhodnutí admina — hromadná úprava ho
        // nepřepíše, jen spočítá. U rozsahu „všechny" se proto nefiltruje datem,
        // jinak by ručně přesunutý termín mimo období vypadl z výběru.
        $since = $scope === 'all' ? null : $from;

        $existing = $this->db->all(
            'SELECT id, DATE(starts_at) AS day FROM event
              WHERE series_id = ? AND (? IS NULL OR DATE(starts_at) >= ?) AND overridden = 0',
            [$oldId, $since, $since],
        );

        $skipped = (int) $this->db->value(
            'SELECT COUNT(*) FROM event
              WHERE series_id = ? AND (? IS NULL OR DATE(starts_at) >= ?) AND overridden = 1',
            [$oldId, $since, $since],
        );

        $byDay = [];
        foreach ($existing as $row) {
            $byDay[(string) $row['day']] = (int) $row['id'];
        }

        if ($scope === 'following') {
            // Původní série končí den před hranicí; od ní dál platí nová.
            $this->db->run(
                'UPDATE event_series SET active_to = DATE_SUB(?, INTERVAL 1 DAY) WHERE id = ?',
                [$from, $oldId],
            );
            $targetId = $this->insertSeries($seasonId, $input, $from, $to);
        } else {
            $this->db->run(
                'UPDATE event_series
                    SET title = ?, type = ?, rrule = ?, start_time = ?, duration_min = ?,
                        location_id = ?, meet_before_min = ?, default_note = ?, active_from = ?, active_to = ?
                  WHERE id = ?',
                [
                    $input['title'],
                    $input['type'],
                    $input['rrule'],
                    $input['startTime'] . ':00',
                    $input['durationMin'],
                    $input['locationId'],
                    $input['meetBeforeMin'],
                    $input['defaultNote'],
                    $from,
                    $to,
                    $oldId,
                ],
            );
            $targetId = $oldId;
        }

        $updated = 0;
        $created = 0;

        foreach ($dates as $date) {
            $startsAt = $date . ' ' . $input['startTime'] . ':00';

            if (isset($byDay[$date])) {
                $this->db->run(
                    'UPDATE event
                        SET series_id = ?, type = ?, title = ?, starts_at = ?,
                            ends_at = DATE_ADD(?, INTERVAL ? MINUTE),
                            meet_at = CASE WHEN ? IS NULL THEN NULL ELSE DATE_SUB(?, INTERVAL ? MINUTE) END,
                            location_id = ?
                      WHERE id = ?',
                    [
                        $targetId,
                        $input['type'],
                        $input['title'],
                        $startsAt,
                        $startsAt,
                        $input['durationMin'],
                        $input['meetBeforeMin'],
                        $startsAt,
                        $input['meetBeforeMin'],
                        $input['locationId'],
                        $byDay[$date],
                    ],
                );

                unset($byDay[$date]);
                $updated++;

                continue;
            }

            $this->insertEvent($seasonId, $targetId, $input, $startsAt);
            $created++;
        }

        // Co v novém pravidle nezbylo, se maže i s odpověďmi. Peníze přežijí:
        // vazba prohřešku na akci je ON DELETE SET NULL, zápis zůstane.
        foreach ($byDay as $eventId) {
            $this->db->run('DELETE FROM event WHERE id = ?', [$eventId]);
        }

        return [
            'series'  => $this->seriesPayload($targetId),
            'updated' => $updated,
            'created' => $created,
            'deleted' => count($byDay),
            'skipped' => $skipped,
        ];
    }

    /**
     * Smaže opakovanou akci v zadaném rozsahu — i termíny s odpověďmi, ručně
     * upravené, a při `all` i minulé. Docházka zmizí s nimi, peníze ne: vazba
     * prohřešku i dávky na akci je ON DELETE SET NULL.
     *
     * @return array{deleted:int,kept:int}
     */
    public function deleteSeries(Identity $identity, int $seriesId, string $scope, ?int $fromEventId): array
    {
        $series = $this->seriesRow($seriesId);
        $this->scope->writableSeason($identity, (int) $series['season_id'], Role::Admin);

        $this->assertScope($scope);

        $from = $this->boundary($series, $scope, $fromEventId);

        return $this->db->transaction(function () use ($series, $from, $scope): array {
            $seriesId = (int) $series['id'];

            // Rozsah „všechny" nesmí být omezený datem, jinak by minulé termíny přežily.
            $since = $scope === 'all' ? null : $from;

            $doomed = $this->db->all(
                'SELECT id FROM event WHERE series_id = ? AND (? IS NULL OR DATE(starts_at) >= ?)',
                [$seriesId, $since, $since],
            );

            foreach ($doomed as $event) {
                $this->db->run('DELETE FROM event WHERE id = ?', [(int) $event['id']]);
            }

            $kept = (int) $this->db->value('SELECT COUNT(*) FROM event WHERE series_id = ?', [$seriesId]);

            if ($scope === 'all' || $kept === 0) {
                // FK na sérii je ON DELETE SET NULL, případné zbytky zůstanou samostatné.
                $this->db->run('DELETE FROM event_series WHERE id = ?', [$seriesId]);
            } else {
                $this->db->run(
                    'UPDATE event_series SET active_to = DATE_SUB(?, INTERVAL 1 DAY) WHERE id = ?',
                    [$from, $seriesId],
                );
            }

            return ['deleted' => count($doomed), 'kept' => $kept];
        });
    }

    /**
     * Od kterého dne se změna projeví. `all` bere sérii od začátku, `following`
     * od data předaného termínu — ten musí do série patřit.
     *
     * @param array<string,mixed> $series
     */
    private function boundary(array $series, string $scope, ?int $fromEventId): string
    {
        if ($scope === 'all') {
            return (string) $series['active_from'];
        }

        if ($fromEventId === null) {
            throw ApiException::validation('Chybí termín, od kterého se má změna projevit.', ['field' => 'fromEventId']);
        }

        $day = $this->db->value(
            'SELECT DATE(starts_at) FROM event WHERE id = ? AND series_id = ?',
            [$fromEventId, (int) $series['id']],
        );

        if ($day === null) {
            throw ApiException::validation('Ten termín do téhle série nepatří.', ['field' => 'fromEventId']);
        }

        return (string) $day;
    }

    private function assertScope(string $scope): void
    {
        if (!in_array($scope, self::SCOPES, true)) {
            throw ApiException::validation('Neznámý rozsah změny.', ['field' => 'scope']);
        }
    }

    /** @return array<string,mixed> */
    private function seriesRow(int $seriesId): array
    {
        $row = $this->db->first('SELECT * FROM event_series WHERE id = ?', [$seriesId]);

        if ($row === null) {
            throw ApiException::notFound();
        }

        return $row;
    }

    /**
     * Odpověď hráče za sebe: jdu / nejdu, případně „vezu autem".
     *
     * @param  array{rsvp:string,note:string|null,transport:string,carSeats:int|null} $input
     * @return EventDetail
     */
    public function saveRsvp(Identity $identity, int $eventId, array $input): array
    {
        $teamId = $this->scope->event($identity, $eventId, Role::Player);
        $this->assertOpenSeason($eventId);

        if (!in_array($input['rsvp'], self::RSVP_VALUES, true)) {
            throw ApiException::validation('Neznámá odpověď.', ['field' => 'rsvp']);
        }

        if (!in_array($input['transport'], self::TRANSPORT_VALUES, true)) {
            throw ApiException::validation('Neznámý způsob dopravy.', ['field' => 'transport']);
        }

        $event = $this->db->first(
            'SELECT e.starts_at, e.status, e.type, e.location_id,
                    (SELECT ts.home_location_id FROM team_settings ts WHERE ts.team_id = ?) AS home_location_id
               FROM event e WHERE e.id = ?',
            [$teamId, $eventId],
        );

        if ($event === null) {
            throw ApiException::notFound();
        }

        if ((string) $event['status'] === 'cancelled') {
            throw ApiException::conflict('EVENT_CANCELLED', 'Akce je zrušená.', ['eventId' => $eventId]);
        }

        // Po začátku akce už je z odpovědi docházka; její změna by byla přepis historie.
        if ($this->hasStarted((string) $event['starts_at'])) {
            throw ApiException::conflict(
                'EVENT_STARTED',
                'Akce už začala, odpověď se nedá změnit. Opravu zapíše pínař.',
                ['eventId' => $eventId],
            );
        }

        $membershipId = $this->membershipOf($identity, $teamId);

        if ($membershipId === null) {
            throw ApiException::forbidden('Za sebe může odpovědět jen člen družstva.');
        }

        // Odvozy jen u venkovního zápasu a jen u toho, kdo přijede — na trénink
        // i domácí zápas se každý dopraví sám. Hodnota se jen srovná na `none`,
        // ne zamítne chybou, jinak by přepnutí na „nepřijdu" spadlo na 400.
        $away = (string) $event['type'] === 'match' && $this->resolveHome([
            'type'             => $event['type'],
            'home_location_id' => $event['home_location_id'],
            'location_id'      => $event['location_id'],
        ]) !== true;

        $transport = $away && $input['rsvp'] === 'yes' ? $input['transport'] : 'none';

        // Řidič bez volných míst je platný údaj, spolujezdec s auty ne.
        $carSeats = $transport === 'driver' ? $input['carSeats'] : null;

        $this->db->run(
            'INSERT INTO event_participant (event_id, membership_id, rsvp, rsvp_note, rsvp_at, transport, car_seats)
             VALUES (?, ?, ?, ?, NOW(), ?, ?)
             ON DUPLICATE KEY UPDATE
                 rsvp      = VALUES(rsvp),
                 rsvp_note = VALUES(rsvp_note),
                 rsvp_at   = NOW(),
                 transport = VALUES(transport),
                 car_seats = VALUES(car_seats)',
            [$eventId, $membershipId, $input['rsvp'], $input['note'], $transport, $carSeats],
        );

        return $this->detail($identity, $eventId);
    }

    /**
     * Ruční oprava docházky. `null` opravu zruší a vrátí odvození z RSVP.
     *
     * Součástí opravy je i doprava: kdo autem jel, ale zapomněl to říct předem,
     * se jinak nemá jak k cesťáku dostat — odpověď je po začátku akce zamčená.
     * `transport` v položce se bere jen u venkovního zápasu; `null` znamená
     * „nech, jak je", aby oprava samotné docházky odvozy nepřepisovala.
     *
     * @param  list<array{membershipId:int,attendance:string|null,transport?:string|null,carSeats?:int|null}> $items
     * @return EventDetail
     */
    public function saveAttendance(Identity $identity, int $eventId, array $items): array
    {
        $teamId = $this->scope->event($identity, $eventId, Role::Treasurer);
        $this->assertOpenSeason($eventId);

        if ($items === []) {
            throw ApiException::validation('Není co opravit.', ['field' => 'items']);
        }

        foreach ($items as $item) {
            if ($item['attendance'] !== null && !in_array($item['attendance'], self::ATTENDANCE_VALUES, true)) {
                throw ApiException::validation('Neznámý stav docházky.', ['field' => 'attendance']);
            }
            if (($item['transport'] ?? null) !== null && !in_array($item['transport'], self::TRANSPORT_VALUES, true)) {
                throw ApiException::validation('Neznámý způsob dopravy.', ['field' => 'transport']);
            }
        }

        $this->assertMembers($teamId, array_map(static fn (array $item): int => $item['membershipId'], $items));

        $event = $this->db->first(
            'SELECT e.type, e.location_id,
                    (SELECT ts.home_location_id FROM team_settings ts WHERE ts.team_id = ?) AS home_location_id
               FROM event e WHERE e.id = ?',
            [$teamId, $eventId],
        );

        if ($event === null) {
            throw ApiException::notFound();
        }

        $away = (string) $event['type'] === 'match' && $this->resolveHome($event) !== true;

        $this->db->transaction(function () use ($eventId, $items, $identity, $away): int {
            foreach ($items as $item) {
                $this->db->run(
                    'INSERT INTO event_participant (event_id, membership_id, attendance, attendance_by, attendance_at)
                     VALUES (?, ?, ?, ?, NOW())
                     ON DUPLICATE KEY UPDATE
                         attendance    = VALUES(attendance),
                         attendance_by = VALUES(attendance_by),
                         attendance_at = NOW()',
                    [$eventId, $item['membershipId'], $item['attendance'], $identity->userId],
                );

                $transport = $item['transport'] ?? null;
                if (!$away || $transport === null) {
                    continue;
                }

                // Kdo na zápase nebyl, nikoho nesvezl — jinak by po opravě docházky
                // zůstal viset nárok na cesťák za cestu, která se nestala.
                $absent    = $item['attendance'] === 'absent' || $item['attendance'] === 'injured';
                $transport = $absent ? 'none' : $transport;
                $carSeats  = $transport === 'driver' ? ($item['carSeats'] ?? null) : null;

                $this->db->run(
                    'UPDATE event_participant SET transport = ?, car_seats = ?
                      WHERE event_id = ? AND membership_id = ?',
                    [$transport, $carSeats, $eventId, $item['membershipId']],
                );
            }

            return count($items);
        });

        return $this->detail($identity, $eventId);
    }

    /**
     * Nominace na zápas. U tréninku nedává smysl — nominovat na trénink bylo
     * vyhodnoceno jako zbytečná byrokracie.
     *
     * @param  list<array{membershipId:int,nomination:string}> $items
     * @return EventDetail
     */
    public function saveNominations(Identity $identity, int $eventId, array $items): array
    {
        $teamId = $this->scope->event($identity, $eventId, Role::Admin);
        $this->assertOpenSeason($eventId);

        $type = (string) $this->db->value('SELECT type FROM event WHERE id = ?', [$eventId]);

        if ($type !== 'match') {
            throw ApiException::conflict(
                'NOT_A_MATCH',
                'Nominace se sestavuje jen u zápasu.',
                ['eventId' => $eventId],
            );
        }

        foreach ($items as $item) {
            if (!in_array($item['nomination'], self::NOMINATIONS, true)) {
                throw ApiException::validation('Neznámý stav nominace.', ['field' => 'nomination']);
            }
        }

        $this->assertMembers($teamId, array_map(static fn (array $item): int => $item['membershipId'], $items));

        // Mění se jen poslaní hráči, zbytek zůstává. Klient posílá jedno jméno
        // po kliknutí, takže hromadný přepis by přemazal souběžnou změnu.
        $this->db->transaction(function () use ($eventId, $items): int {
            foreach ($items as $item) {
                $this->db->run(
                    'INSERT INTO event_participant (event_id, membership_id, nomination)
                     VALUES (?, ?, ?)
                     ON DUPLICATE KEY UPDATE nomination = VALUES(nomination)',
                    [$eventId, $item['membershipId'], $item['nomination']],
                );
            }

            return count($items);
        });

        return $this->detail($identity, $eventId);
    }

    /**
     * Procenta účasti za sezónu. Souhrn o celém týmu je jen pro admina —
     * hráč vidí svůj řádek. Zranění se do jmenovatele nepočítá.
     *
     * @return list<AttendanceRow>
     */
    public function summary(Identity $identity, int $seasonId, ?string $type): array
    {
        $teamId = $this->scope->season($identity, $seasonId, Role::Player);

        if ($type !== null) {
            $this->assertType($type);
        }

        $everyone       = $this->managesTeam($identity, $teamId, Role::Admin);
        $myMembershipId = $this->membershipOf($identity, $teamId);

        if (!$everyone && $myMembershipId === null) {
            return [];
        }

        $rows = $this->db->all(
            "SELECT m.id AS membership_id, m.user_id, m.jersey_number, u.display_name,
                    SUM(state = 'present') AS present,
                    SUM(state = 'absent')  AS absent,
                    SUM(state = 'injured') AS injured
               FROM (
                    -- Bere se ze soupisky, ne z účastnického řádku: kdo neodpověděl,
                    -- taky se počítá.
                    SELECT r.membership_id,
                           COALESCE(p.attendance, IF(p.rsvp = 'yes', 'present', 'absent')) AS state
                      FROM event e
                      JOIN roster_entry r ON r.season_id = e.season_id AND r.active = 1
                      LEFT JOIN event_participant p ON p.event_id = e.id AND p.membership_id = r.membership_id
                     WHERE e.season_id = ? AND e.status <> 'cancelled' AND e.starts_at <= NOW()
                       AND (? IS NULL OR e.type = ?)
               ) AS resolved
               JOIN membership m ON m.id = resolved.membership_id
               JOIN `user` u ON u.id = m.user_id
              WHERE (? = 1 OR m.id = ?)
              GROUP BY m.id, m.user_id, m.jersey_number, u.display_name
              ORDER BY u.display_name",
            [$seasonId, $type, $type, $everyone ? 1 : 0, $myMembershipId ?? 0],
        );

        return array_map(static function (array $row): array {
            $present = (int) $row['present'];
            $absent  = (int) $row['absent'];
            $counted = $present + $absent;

            return [
                'membershipId' => (int) $row['membership_id'],
                'userId'       => (int) $row['user_id'],
                'name'         => (string) $row['display_name'],
                'jerseyNumber' => $row['jersey_number'] === null ? null : (int) $row['jersey_number'],
                'present'      => $present,
                'absent'       => $absent,
                'injured'      => (int) $row['injured'],
                'total'        => $counted,
                'ratio'        => $counted === 0 ? null : round($present / $counted, 4),
            ];
        }, $rows);
    }

    // ------------------------------------------------------------------ čtení

    /**
     * Společný SELECT pro kalendář i detail. Dva první parametry jsou vždy
     * `seasonId` a `userId` — podle nich se dohledá řádek volajícího.
     */
    private function eventSelect(): string
    {
        return "SELECT e.id, e.season_id, e.series_id, e.type, e.title, e.starts_at, e.ends_at, e.meet_at,
                       e.opponent, e.note, e.distance_km, e.nomination_deadline, e.status, e.location_id,
                       e.overridden,
                       (e.starts_at <= NOW()) AS started,
                       (SELECT ts.home_location_id
                          FROM team_settings ts
                          JOIN season hs ON hs.team_id = ts.team_id
                         WHERE hs.id = e.season_id) AS home_location_id,
                       l.id AS loc_id, l.name AS loc_name, l.address AS loc_address,
                       l.lat AS loc_lat, l.lng AS loc_lng, l.note AS loc_note,
                       (SELECT COUNT(*) FROM event_participant p
                         WHERE p.event_id = e.id AND p.rsvp = 'yes') AS yes_count,
                       (SELECT COUNT(*) FROM event_participant p
                         WHERE p.event_id = e.id AND p.rsvp = 'no') AS no_count,
                       mine.id AS my_membership_id,
                       mp.rsvp AS my_rsvp, mp.rsvp_note AS my_rsvp_note, mp.nomination AS my_nomination,
                       mp.transport AS my_transport, mp.car_seats AS my_car_seats,
                       mp.attendance AS my_attendance
                  FROM event e
                  LEFT JOIN location l ON l.id = e.location_id
                  LEFT JOIN membership mine
                         ON mine.team_id = (SELECT s.team_id FROM season s WHERE s.id = ?)
                        AND mine.user_id = ?
                        AND mine.status <> 'left'
                  LEFT JOIN event_participant mp ON mp.event_id = e.id AND mp.membership_id = mine.id";
    }

    /**
     * @param  array<string,mixed> $row
     * @return EventPayload
     */
    private function mapEvent(array $row, int $rosterCount): array
    {
        $yes = (int) $row['yes_count'];
        $no  = (int) $row['no_count'];

        $started   = (bool) $row['started'];
        $cancelled = (string) $row['status'] === 'cancelled';
        $isHome    = $this->resolveHome($row);

        // Domácí halu lze nastavit až po vyplnění vzdálenosti u zápasu. Hodnota
        // zůstane uložená, ale ven se nevydává, jinak by appka tvrdila cestu
        // do vlastní haly.
        $distanceKm = $isHome === true || $row['distance_km'] === null ? null : (int) $row['distance_km'];

        return [
            'id'                 => (int) $row['id'],
            'seasonId'           => (int) $row['season_id'],
            'seriesId'           => $row['series_id'] === null ? null : (int) $row['series_id'],
            'type'               => (string) $row['type'],
            'title'              => (string) $row['title'],
            'startsAt'           => (string) $row['starts_at'],
            'endsAt'             => $row['ends_at'] === null ? null : (string) $row['ends_at'],
            'meetAt'             => $row['meet_at'] === null ? null : (string) $row['meet_at'],
            'location'           => $this->mapLocation($row),
            'opponent'           => $row['opponent'] === null ? null : (string) $row['opponent'],
            'note'               => $row['note'] === null ? null : (string) $row['note'],
            'distanceKm'         => $distanceKm,
            'nominationDeadline' => $row['nomination_deadline'] === null
                ? null
                : (string) $row['nomination_deadline'],
            'status'             => (string) $row['status'],
            'isHome'             => $isHome,
            // Ručně upravený termín hromadná změna série přeskočí.
            'overridden'         => (bool) $row['overridden'],
            'started'            => $started,
            'rosterCount'        => $rosterCount,
            'counts'             => [
                'yes'     => $yes,
                'no'      => $no,
                // Kdo neodpověděl. Nemůže být záporné, i když odpoví někdo mimo soupisku.
                'unknown' => max(0, $rosterCount - $yes - $no),
            ],
            'me'                 => $row['my_membership_id'] === null ? null : [
                'membershipId' => (int) $row['my_membership_id'],
                'rsvp'         => $row['my_rsvp'] === null ? 'unknown' : (string) $row['my_rsvp'],
                'rsvpNote'     => $row['my_rsvp_note'] === null ? null : (string) $row['my_rsvp_note'],
                'nomination'   => $this->resolveNomination((string) $row['type'], $row['my_nomination']),
                'transport'    => $row['my_transport'] === null ? 'none' : (string) $row['my_transport'],
                'carSeats'     => $row['my_car_seats'] === null ? null : (int) $row['my_car_seats'],
                'attendance'   => $this->resolveAttendance(
                    $started,
                    $cancelled,
                    $row['my_attendance'],
                    $row['my_rsvp'],
                ),
            ],
        ];
    }

    /**
     * Jede, nebo je náhradník — třetí stav neexistuje. Kdo je na soupisce, na
     * zápas jede, dokud ho admin neoznačí za náhradníka; „nenominován" by jen
     * nutil admina odklikat celý tým.
     */
    private function resolveNomination(string $type, mixed $stored): string
    {
        if ($type !== 'match') {
            return 'none';
        }

        return (string) $stored === 'substitute' ? 'substitute' : 'nominated';
    }

    /**
     * Hraje se doma? `null` znamená „nevíme" — u tréninku nedává smysl, u zápasu
     * bez místa nebo domácí haly by to bylo hádání. Rozdíl je důležitý kvůli
     * cesťákům: za domácí zápas náhrada nevzniká.
     *
     * @param array<string,mixed> $row
     */
    private function resolveHome(array $row): ?bool
    {
        if ((string) $row['type'] !== 'match') {
            return null;
        }

        $home  = $row['home_location_id'];
        $where = $row['location_id'];

        if ($home === null || $where === null) {
            return null;
        }

        return (int) $home === (int) $where;
    }

    /**
     * Kdo přijde. Vedle soupisky sem patří i ten, kdo z ní vypadl, ale u akce
     * záznam má — jinak by po přesunu do jiného družstva zmizel z historie.
     *
     * @return list<ParticipantPayload>
     */
    private function participants(
        int $eventId,
        int $seasonId,
        int $teamId,
        bool $canSeeAttendance,
        ?int $myMembershipId,
    ): array {
        $event = $this->db->first('SELECT starts_at, status, type FROM event WHERE id = ?', [$eventId]);

        if ($event === null) {
            throw ApiException::notFound();
        }

        $started   = $this->hasStarted((string) $event['starts_at']);
        $cancelled = (string) $event['status'] === 'cancelled';
        $type      = (string) $event['type'];

        $rows = $this->db->all(
            'SELECT m.id AS membership_id, m.user_id, m.jersey_number, u.display_name,
                    r.id IS NOT NULL AS on_roster,
                    p.nomination, p.rsvp, p.rsvp_note, p.transport, p.car_seats, p.attendance
               FROM membership m
               JOIN `user` u ON u.id = m.user_id
               LEFT JOIN roster_entry r ON r.membership_id = m.id AND r.season_id = ? AND r.active = 1
               LEFT JOIN event_participant p ON p.event_id = ? AND p.membership_id = m.id
              WHERE m.team_id = ? AND (r.id IS NOT NULL OR p.id IS NOT NULL)
              ORDER BY r.id IS NULL, u.display_name',
            [$seasonId, $eventId, $teamId],
        );

        return array_map(function (array $row) use (
            $started,
            $cancelled,
            $canSeeAttendance,
            $myMembershipId,
            $type,
        ): array {
            $membershipId = (int) $row['membership_id'];
            $mine         = $membershipId === $myMembershipId;

            $attendance = $canSeeAttendance || $mine
                ? $this->resolveAttendance($started, $cancelled, $row['attendance'], $row['rsvp'])
                : null;

            return [
                'membershipId' => $membershipId,
                'userId'       => (int) $row['user_id'],
                'name'         => (string) $row['display_name'],
                'jerseyNumber' => $row['jersey_number'] === null ? null : (int) $row['jersey_number'],
                'onRoster'     => (bool) $row['on_roster'],
                'nomination'   => $this->resolveNomination($type, $row['nomination']),
                'rsvp'         => $row['rsvp'] === null ? 'unknown' : (string) $row['rsvp'],
                'rsvpNote'     => $row['rsvp_note'] === null ? null : (string) $row['rsvp_note'],
                'transport'    => $row['transport'] === null ? 'none' : (string) $row['transport'],
                'carSeats'     => $row['car_seats'] === null ? null : (int) $row['car_seats'],
                'attendance'   => $attendance,
                'corrected'    => $row['attendance'] !== null,
            ];
        }, $rows);
    }

    /**
     * Skutečný stav docházky: ruční oprava má přednost, jinak platí odvození
     * z RSVP. Dokud akce nezačala (nebo je zrušená), docházka není žádná.
     */
    private function resolveAttendance(bool $started, bool $cancelled, mixed $override, mixed $rsvp): ?string
    {
        if (!$started || $cancelled) {
            return null;
        }

        if ($override !== null) {
            return (string) $override;
        }

        return (string) $rsvp === 'yes' ? 'present' : 'absent';
    }

    /**
     * @param  array<string,mixed> $row
     * @return LocationPayload|null
     */
    private function mapLocation(array $row): ?array
    {
        if ($row['loc_id'] === null) {
            return null;
        }

        return [
            'id'      => (int) $row['loc_id'],
            'name'    => (string) $row['loc_name'],
            'address' => $row['loc_address'] === null ? null : (string) $row['loc_address'],
            'lat'     => $row['loc_lat'] === null ? null : (float) $row['loc_lat'],
            'lng'     => $row['loc_lng'] === null ? null : (float) $row['loc_lng'],
            'note'    => $row['loc_note'] === null ? null : (string) $row['loc_note'],
        ];
    }

    /**
     * @param  array<string,mixed> $row
     * @return SeriesPayload
     */
    private function mapSeries(array $row): array
    {
        return [
            'id'            => (int) $row['id'],
            'seasonId'      => (int) $row['season_id'],
            'title'         => (string) $row['title'],
            'type'          => (string) $row['type'],
            'rrule'         => (string) $row['rrule'],
            'startTime'     => substr((string) $row['start_time'], 0, 5),
            'durationMin'   => (int) $row['duration_min'],
            'location'      => $this->mapLocation($row),
            'meetBeforeMin' => $row['meet_before_min'] === null ? null : (int) $row['meet_before_min'],
            'defaultNote'   => $row['default_note'] === null ? null : (string) $row['default_note'],
            'activeFrom'    => (string) $row['active_from'],
            'activeTo'      => (string) $row['active_to'],
            'eventCount'    => (int) $row['event_count'],
        ];
    }

    /**
     * @return EventPayload
     */
    private function eventPayload(Identity $identity, int $eventId): array
    {
        $seasonId = $this->seasonOf($eventId);

        $row = $this->db->first(
            $this->eventSelect() . ' WHERE e.id = ?',
            [$seasonId, $identity->userId, $eventId],
        );

        if ($row === null) {
            throw ApiException::notFound();
        }

        return $this->mapEvent($row, $this->rosterCount($seasonId));
    }

    /**
     * @return SeriesPayload
     */
    private function seriesPayload(int $seriesId): array
    {
        $row = $this->db->first(
            'SELECT s.*, l.id AS loc_id, l.name AS loc_name, l.address AS loc_address,
                    l.lat AS loc_lat, l.lng AS loc_lng, l.note AS loc_note,
                    (SELECT COUNT(*) FROM event e WHERE e.series_id = s.id) AS event_count
               FROM event_series s
               LEFT JOIN location l ON l.id = s.location_id
              WHERE s.id = ?',
            [$seriesId],
        );

        if ($row === null) {
            throw ApiException::notFound();
        }

        return $this->mapSeries($row);
    }

    private function seasonOf(int $eventId): int
    {
        $seasonId = $this->db->value('SELECT season_id FROM event WHERE id = ?', [$eventId]);

        if ($seasonId === null) {
            throw ApiException::notFound();
        }

        return (int) $seasonId;
    }

    private function rosterCount(int $seasonId): int
    {
        return (int) $this->db->value(
            'SELECT COUNT(*) FROM roster_entry WHERE season_id = ? AND active = 1',
            [$seasonId],
        );
    }

    // ------------------------------------------------------------- oprávnění

    /** Role se čte z databáze, ne z tokenu — odebrané oprávnění platí hned. */
    private function managesTeam(Identity $identity, int $teamId, Role $required = Role::Treasurer): bool
    {
        $role = $this->db->value(
            "SELECT role FROM membership WHERE team_id = ? AND user_id = ? AND status <> 'left'",
            [$teamId, $identity->userId],
        );

        return Role::tryFrom((string) $role)?->allows($required) ?? false;
    }

    private function attendanceVisibleToPlayers(int $teamId): bool
    {
        return (bool) $this->db->value(
            'SELECT attendance_visible_to_players FROM team_settings WHERE team_id = ?',
            [$teamId],
        );
    }

    private function membershipOf(Identity $identity, int $teamId): ?int
    {
        $id = $this->db->value(
            "SELECT id FROM membership WHERE team_id = ? AND user_id = ? AND status <> 'left'",
            [$teamId, $identity->userId],
        );

        return $id === null ? null : (int) $id;
    }

    // -------------------------------------------------------------- validace

    private function assertType(string $type): void
    {
        if (!in_array($type, self::TYPES, true)) {
            throw ApiException::validation('Neznámý druh akce.', ['field' => 'type']);
        }
    }

    /**
     * Vzdálenost dává smysl jen tam, kam se jede. U domácího zápasu se zahodí,
     * i kdyby ji admin vyplnil — jinak by z ní vznikl cesťák do vlastní haly.
     */
    private function distanceFor(int $teamId, string $type, ?int $locationId, ?int $distanceKm): ?int
    {
        if ($type !== 'match' || $locationId === null || $distanceKm === null) {
            return $distanceKm;
        }

        $home = $this->db->value('SELECT home_location_id FROM team_settings WHERE team_id = ?', [$teamId]);

        return $home !== null && (int) $home === $locationId ? null : $distanceKm;
    }

    /** Místo musí patřit témuž klubu — jinak by šlo přiřadit halu cizího oddílu. */
    private function assertLocation(?int $locationId, int $teamId): void
    {
        if ($locationId === null) {
            return;
        }

        $found = $this->db->value(
            'SELECT l.id
               FROM location l
               JOIN team t ON t.club_id = l.club_id
              WHERE l.id = ? AND t.id = ?',
            [$locationId, $teamId],
        );

        if ($found === null) {
            throw ApiException::validation('Tohle místo ke klubu nepatří.', ['field' => 'locationId']);
        }
    }

    private function assertTimes(string $startsAt, ?string $endsAt, ?string $meetAt): void
    {
        if ($endsAt !== null && $endsAt <= $startsAt) {
            throw ApiException::validation('Konec musí být po začátku.', ['field' => 'endsAt']);
        }

        if ($meetAt !== null && $meetAt > $startsAt) {
            throw ApiException::validation('Sraz nemůže být po začátku akce.', ['field' => 'meetAt']);
        }
    }

    /** @param list<int> $membershipIds */
    private function assertMembers(int $teamId, array $membershipIds): void
    {
        $ids = array_values(array_unique($membershipIds));

        if ($ids === []) {
            return;
        }

        // Placeholdery vznikají jen z počtu prvků; samotná ID jdou parametry.
        $placeholders = implode(',', array_fill(0, count($ids), '?'));

        $found = $this->db->all(
            "SELECT id FROM membership WHERE team_id = ? AND id IN ($placeholders)",
            [$teamId, ...$ids],
        );

        if (count($found) !== count($ids)) {
            throw ApiException::validation(
                'Seznam obsahuje člena, který do družstva nepatří.',
                ['field' => 'membershipId'],
            );
        }
    }

    /** Do uzavřené sezóny se nezapisuje ani docházka. */
    private function assertOpenSeason(int $eventId): void
    {
        $closed = $this->db->value(
            'SELECT s.closed_at FROM event e JOIN season s ON s.id = e.season_id WHERE e.id = ?',
            [$eventId],
        );

        if ($closed !== null) {
            throw ApiException::conflict(
                'SEASON_CLOSED',
                'Sezóna je uzavřená, zápis nelze provést.',
                ['eventId' => $eventId],
            );
        }
    }

    private function hasStarted(string $startsAt): bool
    {
        return (bool) $this->db->value('SELECT ? <= NOW()', [$startsAt]);
    }

    /** @param array<string,mixed> $changes */
    private function pickString(array $changes, string $key, string $fallback): string
    {
        $value = $changes[$key] ?? null;

        return is_string($value) ? $value : $fallback;
    }

    /** @param array<string,mixed> $changes */
    private function pickNullableString(array $changes, string $key, mixed $fallback): ?string
    {
        if (!array_key_exists($key, $changes)) {
            return $fallback === null ? null : (string) $fallback;
        }

        $value = $changes[$key];

        return is_string($value) ? $value : null;
    }

    /** @param array<string,mixed> $changes */
    private function pickNullableInt(array $changes, string $key, mixed $fallback): ?int
    {
        if (!array_key_exists($key, $changes)) {
            return $fallback === null ? null : (int) $fallback;
        }

        $value = $changes[$key];

        return is_int($value) ? $value : null;
    }
}
