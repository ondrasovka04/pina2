<?php

declare(strict_types=1);

namespace Pina\Tests\Integration;

use Pina\Auth\Identity;
use Pina\Auth\Role;
use Pina\Auth\TeamScope;
use Pina\Http\ApiException;
use Pina\Service\EventService;

/**
 * Docházka se nezapisuje, jen opravuje — většina testů proto hlídá, že se
 * z odpovědi hráče stane správný docházkový stav bez toho, aby něco dělal člověk.
 */
final class EventServiceTest extends DatabaseTestCase
{
    /** Posun termínu od NOW() v minutách — čitelnější než holá čísla. */
    private const HOUR = 60;

    private const DAY = 1440;

    private EventService $service;

    private int $teamId;
    private int $clubId;
    private int $seasonId;
    private int $locationId;

    private int $adminId;
    private int $treasurerId;
    private int $playerId;

    private int $adminMembership;
    private int $treasurerMembership;
    private int $playerMembership;

    protected function setUp(): void
    {
        parent::setUp();

        $this->service = new EventService($this->db, new TeamScope($this->db));

        [$this->clubId, $this->teamId] = $this->makeTeam('prosek', 'Muži');
        $this->seasonId                = $this->makeSeason($this->teamId, '26/27');

        $this->adminId     = $this->makeUser('admin@prosek.cz');
        $this->treasurerId = $this->makeUser('pinar@prosek.cz');
        $this->playerId    = $this->makeUser('hrac@prosek.cz');

        $this->adminMembership     = $this->makeMembership($this->adminId, $this->teamId, 'admin');
        $this->treasurerMembership = $this->makeMembership($this->treasurerId, $this->teamId, 'treasurer');
        $this->playerMembership    = $this->makeMembership($this->playerId, $this->teamId, 'player');

        $this->makeRoster($this->seasonId, [
            $this->adminMembership,
            $this->treasurerMembership,
            $this->playerMembership,
        ]);

        $this->db->run(
            'INSERT INTO location (club_id, name, address) VALUES (?, ?, ?)',
            [$this->clubId, 'Hala Prosek', 'Litoměřická 987/1, Praha 9'],
        );
        $this->locationId = $this->db->lastInsertId();
    }

    // --------------------------------------------------------------- kalendář

    public function testDisabledAttendanceRejectsWritesButKeepsHistoryReadable(): void
    {
        $eventId = $this->makeEvent(2 * self::DAY);
        $this->db->run('INSERT INTO team_settings (team_id, attendance_enabled) VALUES (?, 0)', [$this->teamId]);

        foreach ([
            fn () => $this->service->create(
                $this->identity($this->treasurerId, Role::Treasurer),
                $this->seasonId,
                $this->eventInput(),
            ),
            fn () => $this->service->saveRsvp(
                $this->identity($this->playerId, Role::Player),
                $eventId,
                ['rsvp' => 'yes', 'note' => null, 'transport' => 'none', 'carSeats' => null],
            ),
            fn () => $this->service->saveAttendance(
                $this->identity($this->treasurerId, Role::Treasurer),
                $eventId,
                [['membershipId' => $this->playerMembership, 'attendance' => 'present']],
            ),
        ] as $write) {
            try {
                $write();
                self::fail('Vypnutá docházka musí zápis odmítnout.');
            } catch (ApiException $e) {
                self::assertSame(409, $e->status);
                self::assertSame('ATTENDANCE_DISABLED', $e->errorCode);
            }
        }

        self::assertCount(1, $this->service->calendar(
            $this->identity($this->playerId, Role::Player),
            $this->seasonId,
            null,
            null,
        ));
        self::assertSame($eventId, $this->service->detail(
            $this->identity($this->playerId, Role::Player),
            $eventId,
        )['event']['id']);
        self::assertSame([], $this->service->summary(
            $this->identity($this->playerId, Role::Player),
            $this->seasonId,
            null,
        ));
    }

    public function testCalendarShowsEventsWithAnswerCounts(): void
    {
        $eventId = $this->makeEvent(2 * self::DAY);

        $this->service->saveRsvp($this->identity($this->playerId, Role::Player), $eventId, [
            'rsvp' => 'yes', 'note' => null, 'transport' => 'none', 'carSeats' => null,
        ]);

        $events = $this->service->calendar($this->identity($this->adminId, Role::Admin), $this->seasonId, null, null);

        self::assertCount(1, $events);
        self::assertSame(['yes' => 1, 'no' => 0, 'unknown' => 2], $events[0]['counts']);
        self::assertSame(3, $events[0]['rosterCount']);
        self::assertFalse($events[0]['started']);
    }

    public function testCalendarRespectsDateRange(): void
    {
        $this->makeEvent(-40 * self::DAY);
        $upcoming = $this->makeEvent(2 * self::DAY);

        $from   = (string) $this->db->value('SELECT DATE(NOW())');
        $events = $this->service->calendar($this->identity($this->playerId, Role::Player), $this->seasonId, $from, null);

        self::assertSame([$upcoming], array_column($events, 'id'));
    }

    public function testDeadlineIsInheritedByEventTypeAndCanBeOverridden(): void
    {
        $training = $this->makeEvent(3 * self::DAY);
        $match    = $this->makeEvent(4 * self::DAY, 'match');

        $trainingDetail = $this->service->detail($this->identity($this->playerId, Role::Player), $training);
        $matchDetail    = $this->service->detail($this->identity($this->playerId, Role::Player), $match);

        self::assertSame(
            $this->db->value('SELECT DATE_SUB(starts_at, INTERVAL 24 HOUR) FROM event WHERE id = ?', [$training]),
            $trainingDetail['event']['rsvpDeadlineAt'],
        );
        self::assertSame(
            $this->db->value('SELECT DATE_SUB(starts_at, INTERVAL 48 HOUR) FROM event WHERE id = ?', [$match]),
            $matchDetail['event']['rsvpDeadlineAt'],
        );
        self::assertNull($trainingDetail['event']['rsvpDeadlineCustom']);

        $this->db->run("UPDATE event SET rsvp_deadline_at = '2026-09-14 18:00:00' WHERE id = ?", [$training]);
        $overridden = $this->service->detail($this->identity($this->playerId, Role::Player), $training);

        self::assertSame('2026-09-14 18:00:00', $overridden['event']['rsvpDeadlineAt']);
        self::assertSame('2026-09-14 18:00:00', $overridden['event']['rsvpDeadlineCustom']);
    }

    public function testDeadlineCanBeDisabledAndOtherEventHasNoDefault(): void
    {
        $this->db->run(
            'INSERT INTO team_settings
                 (team_id, rsvp_deadline_training_hours, rsvp_deadline_match_hours)
             VALUES (?, NULL, NULL)',
            [$this->teamId],
        );

        $training = $this->makeEvent(2 * self::DAY);
        $other    = $this->makeEvent(2 * self::DAY, 'other');

        self::assertNull(
            $this->service->detail($this->identity($this->playerId, Role::Player), $training)['event']['rsvpDeadlineAt'],
        );
        self::assertNull(
            $this->service->detail($this->identity($this->playerId, Role::Player), $other)['event']['rsvpDeadlineAt'],
        );
    }

    public function testOtherTeamsEventIsNotFound(): void
    {
        [, $otherTeamId] = $this->makeTeam('benatky', 'Muži');
        $otherSeasonId   = $this->makeSeason($otherTeamId, '26/27');
        $foreignEvent    = $this->makeEvent(2 * self::DAY, seasonId: $otherSeasonId);

        // 404, ne 403 — jinak by odpověď prozradila, že cizí akce existuje.
        $this->expectStatus(404, fn () => $this->service->detail(
            $this->identity($this->adminId, Role::Admin),
            $foreignEvent,
        ));
    }

    // ------------------------------------------------------------------- RSVP

    public function testAnswerStoresWhetherTheLatestChangeWasLate(): void
    {
        $eventId = $this->makeEvent(2 * self::HOUR);
        $this->db->run('UPDATE event SET rsvp_deadline_at = DATE_ADD(NOW(), INTERVAL 1 HOUR) WHERE id = ?', [$eventId]);

        $first = $this->service->saveRsvp($this->identity($this->playerId, Role::Player), $eventId, [
            'rsvp' => 'yes', 'note' => null, 'transport' => 'none', 'carSeats' => null,
        ]);
        self::assertFalse($this->me($first)['rsvpLate']);
        self::assertNotNull($this->me($first)['rsvpAt']);

        $this->db->run('UPDATE event SET rsvp_deadline_at = DATE_SUB(NOW(), INTERVAL 1 HOUR) WHERE id = ?', [$eventId]);
        $second = $this->service->saveRsvp($this->identity($this->playerId, Role::Player), $eventId, [
            'rsvp' => 'no', 'note' => null, 'transport' => 'none', 'carSeats' => null,
        ]);

        self::assertTrue($this->me($second)['rsvpLate']);
        self::assertSame(1, (int) $this->db->value(
            'SELECT rsvp_late FROM event_participant WHERE event_id = ? AND membership_id = ?',
            [$eventId, $this->playerMembership],
        ));
    }

    public function testAnswerBecomesAttendanceAfterTheEventStarts(): void
    {
        // Zápas, ne trénink — jen u něj se drží i domluva na odvozu.
        $eventId = $this->makeEvent(2 * self::HOUR, type: 'match');

        $this->service->saveRsvp($this->identity($this->playerId, Role::Player), $eventId, [
            'rsvp' => 'yes', 'note' => 'jedu rovnou z práce', 'transport' => 'driver', 'carSeats' => 3,
        ]);

        // Dokud akce nezačala, docházka žádná není.
        $before = $this->service->detail($this->identity($this->playerId, Role::Player), $eventId);
        self::assertNull($this->me($before)['attendance']);

        $this->moveEventToPast($eventId);

        $after = $this->service->detail($this->identity($this->playerId, Role::Player), $eventId);

        self::assertSame('present', $this->me($after)['attendance']);
        self::assertSame('driver', $this->me($after)['transport']);
        self::assertSame(3, $this->me($after)['carSeats']);
    }

    public function testWhoDidNotAnswerCountsAsAbsent(): void
    {
        $eventId = $this->makeEvent(-2 * self::HOUR);

        $detail = $this->service->detail($this->identity($this->treasurerId, Role::Treasurer), $eventId);
        $states = array_column($detail['participants'], 'attendance', 'membershipId');

        self::assertSame('absent', $states[$this->playerMembership]);
    }

    public function testAnswerCannotBeChangedAfterTheEventStarts(): void
    {
        $eventId = $this->makeEvent(-1 * self::HOUR);

        // Jinak by si hráč druhý den přepsal vlastní docházku.
        $this->expectStatus(409, fn () => $this->service->saveRsvp(
            $this->identity($this->playerId, Role::Player),
            $eventId,
            ['rsvp' => 'yes', 'note' => null, 'transport' => 'none', 'carSeats' => null],
        ));
    }

    public function testAnswerToCancelledEventIsRejected(): void
    {
        $eventId = $this->makeEvent(2 * self::DAY);
        $this->service->cancel($this->identity($this->adminId, Role::Admin), $eventId);

        $this->expectStatus(409, fn () => $this->service->saveRsvp(
            $this->identity($this->playerId, Role::Player),
            $eventId,
            ['rsvp' => 'yes', 'note' => null, 'transport' => 'none', 'carSeats' => null],
        ));
    }

    public function testWhoDoesNotTakeACarKeepsNoFreeSeats(): void
    {
        $eventId = $this->makeEvent(2 * self::DAY, type: 'match');

        $this->service->saveRsvp($this->identity($this->playerId, Role::Player), $eventId, [
            'rsvp' => 'yes', 'note' => null, 'transport' => 'none', 'carSeats' => 4,
        ]);

        $detail = $this->service->detail($this->identity($this->playerId, Role::Player), $eventId);

        self::assertNull($this->me($detail)['carSeats']);
    }

    /**
     * Doprava má jen dva stavy. Starý klient s „svezu se" musí dostat čitelnou
     * chybu, ne spadnout na neznámé hodnotě enumu až v databázi.
     */
    public function testUnknownTransportIsRejected(): void
    {
        $eventId = $this->makeEvent(2 * self::DAY, type: 'match');

        $this->expectStatus(400, fn () => $this->service->saveRsvp(
            $this->identity($this->playerId, Role::Player),
            $eventId,
            ['rsvp' => 'yes', 'note' => null, 'transport' => 'passenger', 'carSeats' => null],
        ));
    }

    public function testWhoIsNotComingDoesNotDriveAnyone(): void
    {
        $eventId = $this->makeEvent(2 * self::DAY, type: 'match');
        $player  = $this->identity($this->playerId, Role::Player);

        $this->service->saveRsvp($player, $eventId, [
            'rsvp' => 'yes', 'note' => null, 'transport' => 'driver', 'carSeats' => 3,
        ]);

        // Přepnutí na „nepřijdu" musí odvoz zrušit, ne spadnout na validaci.
        $this->service->saveRsvp($player, $eventId, [
            'rsvp' => 'no', 'note' => null, 'transport' => 'driver', 'carSeats' => 3,
        ]);

        $detail = $this->service->detail($player, $eventId);

        self::assertSame('none', $this->me($detail)['transport']);
        self::assertNull($this->me($detail)['carSeats']);
    }

    public function testHomeMatchHasNoCarpoolingEither(): void
    {
        // Do vlastní haly se každý dopraví sám, stejně jako na trénink.
        $this->setHomeVenue($this->locationId);

        $eventId = $this->makeEvent(2 * self::DAY, type: 'match');
        $this->db->run('UPDATE event SET location_id = ? WHERE id = ?', [$this->locationId, $eventId]);

        $this->service->saveRsvp($this->identity($this->playerId, Role::Player), $eventId, [
            'rsvp' => 'yes', 'note' => null, 'transport' => 'driver', 'carSeats' => 3,
        ]);

        $detail = $this->service->detail($this->identity($this->playerId, Role::Player), $eventId);

        self::assertSame('none', $this->me($detail)['transport']);
    }

    public function testAwayMatchKeepsCarpooling(): void
    {
        $this->setHomeVenue($this->locationId);

        $this->db->run('INSERT INTO location (club_id, name) VALUES (?, ?)', [$this->clubId, 'Hala soupeře']);
        $awayId = $this->db->lastInsertId();

        $eventId = $this->makeEvent(2 * self::DAY, type: 'match');
        $this->db->run('UPDATE event SET location_id = ? WHERE id = ?', [$awayId, $eventId]);

        $this->service->saveRsvp($this->identity($this->playerId, Role::Player), $eventId, [
            'rsvp' => 'yes', 'note' => null, 'transport' => 'driver', 'carSeats' => 3,
        ]);

        $detail = $this->service->detail($this->identity($this->playerId, Role::Player), $eventId);

        self::assertSame('driver', $this->me($detail)['transport']);
        self::assertSame(3, $this->me($detail)['carSeats']);
    }

    public function testTrainingHasNoCarpooling(): void
    {
        // Odvozy dávají smysl jen u zápasů; na trénink se jezdí samostatně.
        $eventId = $this->makeEvent(2 * self::DAY);

        $this->service->saveRsvp($this->identity($this->playerId, Role::Player), $eventId, [
            'rsvp' => 'yes', 'note' => null, 'transport' => 'driver', 'carSeats' => 3,
        ]);

        $detail = $this->service->detail($this->identity($this->playerId, Role::Player), $eventId);

        self::assertSame('none', $this->me($detail)['transport']);
    }

    // -------------------------------------------------------------- opravy

    public function testCorrectionOverridesTheAnswerAndCanBeTakenBack(): void
    {
        $eventId = $this->makeEvent(2 * self::HOUR);

        $this->service->saveRsvp($this->identity($this->playerId, Role::Player), $eventId, [
            'rsvp' => 'yes', 'note' => null, 'transport' => 'none', 'carSeats' => null,
        ]);
        $this->moveEventToPast($eventId);

        $treasurer = $this->identity($this->treasurerId, Role::Treasurer);

        $corrected = $this->service->saveAttendance($treasurer, $eventId, [
            ['membershipId' => $this->playerMembership, 'attendance' => 'absent'],
        ]);
        self::assertSame('absent', $this->stateOf($corrected, $this->playerMembership));
        self::assertTrue($this->participant($corrected, $this->playerMembership)['corrected']);

        // Zrušení opravy vrátí odvození z odpovědi hráče.
        $reverted = $this->service->saveAttendance($treasurer, $eventId, [
            ['membershipId' => $this->playerMembership, 'attendance' => null],
        ]);
        self::assertSame('present', $this->stateOf($reverted, $this->playerMembership));
        self::assertFalse($this->participant($reverted, $this->playerMembership)['corrected']);
    }

    public function testTreasurerCanAddForgottenDriverAfterTheMatch(): void
    {
        $eventId = $this->makeAwayMatch();
        $this->service->saveRsvp($this->identity($this->playerId, Role::Player), $eventId, [
            'rsvp' => 'yes', 'note' => null, 'transport' => 'none', 'carSeats' => null,
        ]);
        $this->moveEventToPast($eventId);

        $treasurer = $this->identity($this->treasurerId, Role::Treasurer);
        $detail    = $this->service->saveAttendance($treasurer, $eventId, [
            ['membershipId' => $this->playerMembership, 'attendance' => null, 'transport' => 'driver', 'carSeats' => 3],
        ]);

        self::assertSame('driver', $this->participant($detail, $this->playerMembership)['transport']);
        self::assertSame('present', $this->stateOf($detail, $this->playerMembership));
    }

    public function testCorrectionWithoutTransportLeavesTheRideAlone(): void
    {
        $eventId = $this->makeAwayMatch();
        $this->service->saveRsvp($this->identity($this->playerId, Role::Player), $eventId, [
            'rsvp' => 'yes', 'note' => null, 'transport' => 'driver', 'carSeats' => 3,
        ]);
        $this->moveEventToPast($eventId);

        $detail = $this->service->saveAttendance($this->identity($this->treasurerId, Role::Treasurer), $eventId, [
            ['membershipId' => $this->playerMembership, 'attendance' => null],
        ]);

        self::assertSame('driver', $this->participant($detail, $this->playerMembership)['transport']);
    }

    public function testAbsentDriverLosesTheRide(): void
    {
        $eventId = $this->makeAwayMatch();
        $this->service->saveRsvp($this->identity($this->playerId, Role::Player), $eventId, [
            'rsvp' => 'yes', 'note' => null, 'transport' => 'driver', 'carSeats' => 3,
        ]);
        $this->moveEventToPast($eventId);

        // Kdo nepřijel, nikoho nesvezl — jinak by mu zůstal nárok na cesťák.
        $detail = $this->service->saveAttendance($this->identity($this->treasurerId, Role::Treasurer), $eventId, [
            ['membershipId' => $this->playerMembership, 'attendance' => 'absent', 'transport' => 'driver'],
        ]);

        self::assertSame('none', $this->participant($detail, $this->playerMembership)['transport']);
    }

    public function testTransportCorrectionIsIgnoredOnTraining(): void
    {
        $eventId = $this->makeEvent(2 * self::HOUR);
        $this->service->saveRsvp($this->identity($this->playerId, Role::Player), $eventId, [
            'rsvp' => 'yes', 'note' => null, 'transport' => 'none', 'carSeats' => null,
        ]);
        $this->moveEventToPast($eventId);

        $detail = $this->service->saveAttendance($this->identity($this->treasurerId, Role::Treasurer), $eventId, [
            ['membershipId' => $this->playerMembership, 'attendance' => null, 'transport' => 'driver'],
        ]);

        self::assertSame('none', $this->participant($detail, $this->playerMembership)['transport']);
    }

    /**
     * Kalendář plánuje ten, kdo chodí na tréninky — tedy i pínař, ne jen admin.
     * Nominace zůstává adminovi, ta je o sestavě, ne o provozu.
     */
    public function testTreasurerPlansTheCalendar(): void
    {
        $treasurer = $this->identity($this->treasurerId, Role::Treasurer);

        $eventId = $this->service->create($treasurer, $this->seasonId, $this->eventInput())['id'];

        $this->service->update($treasurer, $eventId, ['title' => 'Přesunutý trénink']);
        $this->service->cancel($treasurer, $eventId);
        $this->service->restore($treasurer, $eventId);

        $series = $this->service->createSeries($treasurer, $this->seasonId, $this->seriesInput());
        $this->service->deleteSeries($treasurer, $series['series']['id'], 'all', null);

        $this->service->delete($treasurer, $eventId);

        self::assertNull($this->db->value('SELECT id FROM event WHERE id = ?', [$eventId]));
    }

    public function testPlayerStillCannotPlanTheCalendar(): void
    {
        $player = $this->identity($this->playerId, Role::Player);

        $this->expectStatus(403, fn () => $this->service->create($player, $this->seasonId, $this->eventInput()));
    }

    public function testDeadlineAfterEventStartIsRejected(): void
    {
        try {
            $this->service->create(
                $this->identity($this->treasurerId, Role::Treasurer),
                $this->seasonId,
                [
                    ...$this->eventInput(),
                    'startsAt'       => '2026-09-15 19:00:00',
                    'rsvpDeadlineAt' => '2026-09-15 19:01:00',
                ],
            );
            self::fail('Termín po začátku akce se nesmí uložit.');
        } catch (ApiException $e) {
            self::assertSame(400, $e->status);
            self::assertSame('rsvpDeadlineAt', $e->details['field'] ?? null);
        }
    }

    public function testNominationStaysWithAdmin(): void
    {
        $eventId = $this->makeEvent(2 * self::HOUR, 'match');

        $this->expectStatus(403, fn () => $this->service->saveNominations(
            $this->identity($this->treasurerId, Role::Treasurer),
            $eventId,
            [['membershipId' => $this->playerMembership, 'nomination' => 'substitute']],
        ));
    }

    public function testPlayerCannotCorrectAttendance(): void
    {
        $eventId = $this->makeEvent(-2 * self::HOUR);

        $this->expectStatus(403, fn () => $this->service->saveAttendance(
            $this->identity($this->playerId, Role::Player),
            $eventId,
            [['membershipId' => $this->playerMembership, 'attendance' => 'present']],
        ));
    }

    public function testCorrectionForSomebodyElsesMemberIsRejected(): void
    {
        [, $otherTeamId] = $this->makeTeam('benatky', 'Muži');
        $stranger        = $this->makeMembership($this->makeUser('cizi@benatky.cz'), $otherTeamId, 'player');

        $eventId = $this->makeEvent(-2 * self::HOUR);

        $this->expectStatus(400, fn () => $this->service->saveAttendance(
            $this->identity($this->treasurerId, Role::Treasurer),
            $eventId,
            [['membershipId' => $stranger, 'attendance' => 'present']],
        ));
    }

    // -------------------------------------------------------------- viditelnost

    public function testPlayerDoesNotSeeAttendanceOfOthers(): void
    {
        $eventId = $this->makeEvent(-2 * self::HOUR);

        $detail = $this->service->detail($this->identity($this->playerId, Role::Player), $eventId);

        self::assertFalse($detail['canSeeAttendance']);
        self::assertNull($this->stateOf($detail, $this->adminMembership));
        // Vlastní docházku vidí vždycky.
        self::assertSame('absent', $this->stateOf($detail, $this->playerMembership));

        // Kdo přijde, vidí každý — bez toho by se nedaly domluvit odvozy.
        self::assertSame('unknown', $this->participant($detail, $this->adminMembership)['rsvp']);
    }

    public function testTeamCanOpenAttendanceToPlayers(): void
    {
        $eventId = $this->makeEvent(-2 * self::HOUR);

        $this->db->run(
            'INSERT INTO team_settings (team_id, attendance_visible_to_players) VALUES (?, 1)',
            [$this->teamId],
        );

        $detail = $this->service->detail($this->identity($this->playerId, Role::Player), $eventId);

        self::assertTrue($detail['canSeeAttendance']);
        self::assertSame('absent', $this->stateOf($detail, $this->adminMembership));
    }

    public function testTreasurerSeesAttendanceOfEveryone(): void
    {
        $eventId = $this->makeEvent(-2 * self::HOUR);

        $detail = $this->service->detail($this->identity($this->treasurerId, Role::Treasurer), $eventId);

        self::assertTrue($detail['canSeeAttendance']);
        self::assertSame('absent', $this->stateOf($detail, $this->adminMembership));
    }

    // ------------------------------------------------------------------ souhrn

    public function testSummaryLeavesInjuredOutOfTheRatio(): void
    {
        $first  = $this->makeEvent(-3 * self::DAY);
        $second = $this->makeEvent(-2 * self::DAY);
        $third  = $this->makeEvent(-1 * self::DAY);

        $treasurer = $this->identity($this->treasurerId, Role::Treasurer);

        $this->service->saveAttendance($treasurer, $first, [
            ['membershipId' => $this->playerMembership, 'attendance' => 'present'],
        ]);
        $this->service->saveAttendance($treasurer, $second, [
            ['membershipId' => $this->playerMembership, 'attendance' => 'injured'],
        ]);
        $this->service->saveAttendance($treasurer, $third, [
            ['membershipId' => $this->playerMembership, 'attendance' => 'absent'],
        ]);

        $rows = $this->service->summary($this->identity($this->adminId, Role::Admin), $this->seasonId, null);
        $mine = $this->rowOf($rows, $this->playerMembership);

        self::assertSame(1, $mine['present']);
        self::assertSame(1, $mine['absent']);
        self::assertSame(1, $mine['injured']);
        // Zranění se nepočítá do jmenovatele: 1 ze 2, ne 1 ze 3.
        self::assertSame(2, $mine['total']);
        self::assertSame(0.5, $mine['ratio']);
    }

    public function testSummaryIgnoresCancelledAndFutureEvents(): void
    {
        $this->makeEvent(-1 * self::DAY);
        $cancelled = $this->makeEvent(-2 * self::DAY);
        $this->makeEvent(5 * self::DAY);

        $this->db->run("UPDATE event SET status = 'cancelled' WHERE id = ?", [$cancelled]);

        $rows = $this->service->summary($this->identity($this->adminId, Role::Admin), $this->seasonId, null);

        self::assertSame(1, $this->rowOf($rows, $this->playerMembership)['total']);
    }

    public function testSummaryCanBeNarrowedToMatches(): void
    {
        $this->makeEvent(-2 * self::DAY);
        $this->makeEvent(-1 * self::DAY, type: 'match');

        $rows = $this->service->summary($this->identity($this->adminId, Role::Admin), $this->seasonId, 'match');

        self::assertSame(1, $this->rowOf($rows, $this->playerMembership)['total']);
    }

    public function testSummaryCountsLateAnswers(): void
    {
        $eventId = $this->makeEvent(-1 * self::DAY);
        $this->db->run(
            "INSERT INTO event_participant (event_id, membership_id, rsvp, rsvp_at, rsvp_late)
             VALUES (?, ?, 'yes', DATE_SUB(NOW(), INTERVAL 2 DAY), 1)",
            [$eventId, $this->playerMembership],
        );

        $rows = $this->service->summary($this->identity($this->adminId, Role::Admin), $this->seasonId, null);

        self::assertSame(1, $this->rowOf($rows, $this->playerMembership)['lateRsvpCount']);
        self::assertSame(0, $this->rowOf($rows, $this->adminMembership)['lateRsvpCount']);
    }

    public function testPlayerSeesOnlyOwnNumbers(): void
    {
        $this->makeEvent(-1 * self::DAY);

        $rows = $this->service->summary($this->identity($this->playerId, Role::Player), $this->seasonId, null);

        self::assertSame([$this->playerMembership], array_column($rows, 'membershipId'));
    }

    public function testTreasurerSeesTheWholeTable(): void
    {
        // Pínař docházku opravuje, takže ji musí i vidět — jinak by opravoval naslepo.
        // Hráč pořád dostane jen svůj řádek.
        $this->makeEvent(-1 * self::DAY);

        $rows = $this->service->summary($this->identity($this->treasurerId, Role::Treasurer), $this->seasonId, null);

        self::assertGreaterThan(1, count($rows));
        self::assertContains($this->playerMembership, array_column($rows, 'membershipId'));
    }

    // ---------------------------------------------------------------- nominace

    public function testEverybodyOnTheRosterRidesByDefault(): void
    {
        // Běžnější stav než prázdná nominace: admin jen vypíchne náhradníky.
        $match  = $this->makeEvent(2 * self::DAY, type: 'match');
        $detail = $this->service->detail($this->identity($this->playerId, Role::Player), $match);

        self::assertSame(
            ['nominated', 'nominated', 'nominated'],
            array_column($detail['participants'], 'nomination'),
        );
        self::assertSame('nominated', $this->me($detail)['nomination']);
    }

    public function testMarkingSubstituteLeavesTheRestRiding(): void
    {
        $match = $this->makeEvent(2 * self::DAY, type: 'match');

        $this->service->saveNominations($this->identity($this->adminId, Role::Admin), $match, [
            ['membershipId' => $this->playerMembership, 'nomination' => 'substitute'],
        ]);

        $detail = $this->service->detail($this->identity($this->playerId, Role::Player), $match);

        self::assertSame('substitute', $this->participant($detail, $this->playerMembership)['nomination']);
        // Třetí stav neexistuje: kdo není náhradník, jede.
        self::assertSame('nominated', $this->participant($detail, $this->adminMembership)['nomination']);
    }

    public function testTrainingHasNoNominationAtAll(): void
    {
        $training = $this->makeEvent(2 * self::DAY);
        $detail   = $this->service->detail($this->identity($this->playerId, Role::Player), $training);

        self::assertSame(['none', 'none', 'none'], array_column($detail['participants'], 'nomination'));
    }

    public function testNominationIsOnlyForMatches(): void
    {
        $training = $this->makeEvent(2 * self::DAY);

        $this->expectStatus(409, fn () => $this->service->saveNominations(
            $this->identity($this->adminId, Role::Admin),
            $training,
            [['membershipId' => $this->playerMembership, 'nomination' => 'nominated']],
        ));
    }

    public function testNominationChangesOnlyThePlayersItWasSentFor(): void
    {
        $match = $this->makeEvent(2 * self::DAY, type: 'match');
        $admin = $this->identity($this->adminId, Role::Admin);

        $first = $this->service->saveNominations($admin, $match, [
            ['membershipId' => $this->playerMembership, 'nomination' => 'substitute'],
        ]);
        self::assertSame('substitute', $this->participant($first, $this->playerMembership)['nomination']);

        // Klient posílá jedno jméno po kliknutí — druhá změna nesmí přepsat první.
        $second = $this->service->saveNominations($admin, $match, [
            ['membershipId' => $this->treasurerMembership, 'nomination' => 'substitute'],
        ]);

        self::assertSame('substitute', $this->participant($second, $this->playerMembership)['nomination']);
        self::assertSame('substitute', $this->participant($second, $this->treasurerMembership)['nomination']);

        // Vrácení mezi jedoucí je zase jen jedno jméno.
        $third = $this->service->saveNominations($admin, $match, [
            ['membershipId' => $this->playerMembership, 'nomination' => 'nominated'],
        ]);

        self::assertSame('nominated', $this->participant($third, $this->playerMembership)['nomination']);
        self::assertSame('substitute', $this->participant($third, $this->treasurerMembership)['nomination']);
    }

    public function testTreasurerCannotBuildTheNomination(): void
    {
        $match = $this->makeEvent(2 * self::DAY, type: 'match');

        $this->expectStatus(403, fn () => $this->service->saveNominations(
            $this->identity($this->treasurerId, Role::Treasurer),
            $match,
            [['membershipId' => $this->playerMembership, 'nomination' => 'nominated']],
        ));
    }

    // ------------------------------------------------------------------- akce

    public function testHraciNezakladajiAkce(): void
    {
        $this->expectStatus(403, fn () => $this->service->create(
            $this->identity($this->playerId, Role::Player),
            $this->seasonId,
            $this->eventInput(),
        ));
    }

    public function testEventCannotBorrowAnotherClubsVenue(): void
    {
        [$otherClubId] = $this->makeTeam('benatky', 'Muži');
        $this->db->run('INSERT INTO location (club_id, name) VALUES (?, ?)', [$otherClubId, 'Hala Benátky']);
        $foreignLocation = $this->db->lastInsertId();

        $this->expectStatus(400, fn () => $this->service->create(
            $this->identity($this->adminId, Role::Admin),
            $this->seasonId,
            [...$this->eventInput(), 'locationId' => $foreignLocation],
        ));
    }

    public function testHomeMatchIsRecognisedAndKeepsNoDistance(): void
    {
        $this->setHomeVenue($this->locationId);

        $event = $this->service->create($this->identity($this->adminId, Role::Admin), $this->seasonId, [
            ...$this->eventInput(),
            'type'       => 'match',
            'title'      => 'Zápas doma',
            'opponent'   => 'VK Benátky',
            'distanceKm' => 52,
        ]);

        self::assertTrue($event['isHome']);
        // Cesta do vlastní haly není cesta — jinak by z toho vznikl cesťák.
        self::assertNull($event['distanceKm']);
    }

    public function testAwayMatchKeepsTheDistance(): void
    {
        $this->setHomeVenue($this->locationId);

        $this->db->run('INSERT INTO location (club_id, name) VALUES (?, ?)', [$this->clubId, 'Hala soupeře']);
        $awayId = $this->db->lastInsertId();

        $event = $this->service->create($this->identity($this->adminId, Role::Admin), $this->seasonId, [
            ...$this->eventInput(),
            'type'       => 'match',
            'title'      => 'Zápas venku',
            'locationId' => $awayId,
            'distanceKm' => 52,
        ]);

        self::assertFalse($event['isHome']);
        self::assertSame(52, $event['distanceKm']);
    }

    public function testWithoutHomeVenueNobodyGuesses(): void
    {
        // Bez nastavené domácí haly se „doma" nedá poznat; hádat se nebude.
        $event = $this->service->create($this->identity($this->adminId, Role::Admin), $this->seasonId, [
            ...$this->eventInput(),
            'type'  => 'match',
            'title' => 'Zápas',
        ]);

        self::assertNull($event['isHome']);
    }

    public function testTrainingIsNeitherHomeNorAway(): void
    {
        $this->setHomeVenue($this->locationId);

        $event = $this->service->create(
            $this->identity($this->adminId, Role::Admin),
            $this->seasonId,
            $this->eventInput(),
        );

        self::assertNull($event['isHome']);
    }

    public function testDeletingOneEventTakesTheAttendanceButNotTheMoney(): void
    {
        $eventId  = $this->makeEvent(2 * self::DAY);
        $recordId = $this->makeRecord($this->seasonId, $this->playerMembership);
        $this->db->run('UPDATE offence_record SET event_id = ? WHERE id = ?', [$eventId, $recordId]);

        $this->service->saveRsvp($this->identity($this->playerId, Role::Player), $eventId, [
            'rsvp' => 'yes', 'note' => null, 'transport' => 'none', 'carSeats' => null,
        ]);

        $this->service->delete($this->identity($this->adminId, Role::Admin), $eventId);

        self::assertNull($this->db->value('SELECT id FROM event WHERE id = ?', [$eventId]));
        self::assertSame(
            0,
            (int) $this->db->value('SELECT COUNT(*) FROM event_participant WHERE event_id = ?', [$eventId]),
        );
        // Zápis peněz přežije, jen ztratí vazbu na akci.
        self::assertNotNull($this->db->value('SELECT id FROM offence_record WHERE id = ?', [$recordId]));
        self::assertNull($this->db->value('SELECT event_id FROM offence_record WHERE id = ?', [$recordId]));
    }

    public function testHraciNemazouAkce(): void
    {
        $eventId = $this->makeEvent(2 * self::DAY);

        $this->expectStatus(403, fn () => $this->service->delete(
            $this->identity($this->playerId, Role::Player),
            $eventId,
        ));
    }

    public function testClosedSeasonTakesNoWrites(): void
    {
        $eventId = $this->makeEvent(2 * self::DAY);
        $this->db->run('UPDATE season SET closed_at = NOW() WHERE id = ?', [$this->seasonId]);

        $this->expectStatus(409, fn () => $this->service->saveRsvp(
            $this->identity($this->playerId, Role::Player),
            $eventId,
            ['rsvp' => 'yes', 'note' => null, 'transport' => 'none', 'carSeats' => null],
        ));
    }

    public function testEditingAnEventFromSeriesMarksItOverridden(): void
    {
        $this->service->createSeries(
            $this->identity($this->adminId, Role::Admin),
            $this->seasonId,
            $this->seriesInput(),
        );

        $eventId = (int) $this->db->value('SELECT id FROM event ORDER BY starts_at LIMIT 1');

        $this->service->update($this->identity($this->adminId, Role::Admin), $eventId, ['title' => 'Trénink v tělocvičně']);

        self::assertSame(1, (int) $this->db->value('SELECT overridden FROM event WHERE id = ?', [$eventId]));
    }

    // ------------------------------------------------------------------ série

    public function testSeriesGeneratesEveryDateAtOnce(): void
    {
        $result = $this->service->createSeries(
            $this->identity($this->adminId, Role::Admin),
            $this->seasonId,
            $this->seriesInput(),
        );

        // Úterky a čtvrtky od 1. do 30. září 2026 = 9 termínů.
        self::assertSame(9, $result['created']);
        self::assertSame(0, $result['skipped']);
        self::assertSame(9, $result['series']['eventCount']);

        $first = $this->db->first('SELECT starts_at, ends_at, meet_at FROM event ORDER BY starts_at LIMIT 1');
        self::assertNotNull($first);
        self::assertSame('2026-09-01 19:00:00', (string) $first['starts_at']);
        self::assertSame('2026-09-01 20:30:00', (string) $first['ends_at']);
        self::assertSame('2026-09-01 18:45:00', (string) $first['meet_at']);
    }

    public function testSeriesDoesNotDuplicateExistingDates(): void
    {
        $admin = $this->identity($this->adminId, Role::Admin);

        $this->service->createSeries($admin, $this->seasonId, $this->seriesInput());
        $again = $this->service->createSeries($admin, $this->seasonId, $this->seriesInput());

        self::assertSame(0, $again['created']);
        self::assertSame(9, $again['skipped']);
    }

    public function testSeriesIsClippedToTheSeason(): void
    {
        $result = $this->service->createSeries(
            $this->identity($this->adminId, Role::Admin),
            $this->seasonId,
            [...$this->seriesInput(), 'activeFrom' => '2026-08-01', 'activeTo' => '2026-09-30'],
        );

        // Sezóna začíná až 1. 9., srpnové tréninky se negenerují.
        self::assertSame('2026-09-01', $result['series']['activeFrom']);
        self::assertSame(9, $result['created']);
    }

    public function testDeletingFromOneTermRemovesItAndEverythingAfter(): void
    {
        $admin    = $this->identity($this->adminId, Role::Admin);
        $seriesId = $this->makeSeries($admin);

        $terms = $this->termsOf($seriesId);
        // Kolik termínů už je v minulosti — v tomhle poli ordered ASC je to zároveň
        // index prvního budoucího termínu, na který se dá dělit sérii „following".
        $splitIndex = (int) $this->db->value(
            'SELECT COUNT(*) FROM event WHERE series_id = ? AND starts_at <= NOW()',
            [$seriesId],
        );
        $split = $terms[$splitIndex] ?? null;
        self::assertNotNull($split, 'fixture potřebuje aspoň jeden budoucí termín');

        // I termín, na který už někdo odpověděl, jde smazat — smazat znamená smazat.
        $this->service->saveRsvp($this->identity($this->playerId, Role::Player), $split, [
            'rsvp' => 'yes', 'note' => null, 'transport' => 'none', 'carSeats' => null,
        ]);

        $removal = $this->service->deleteSeries($admin, $seriesId, 'following', $split);

        self::assertSame(count($terms) - $splitIndex, $removal['deleted']);
        self::assertSame($splitIndex, $removal['kept']);
        self::assertNull($this->db->value('SELECT id FROM event WHERE id = ?', [$split]));
        // Série zůstává a jen se zkrátí, protože dva termíny pořád platí.
        self::assertNotNull($this->db->value('SELECT id FROM event_series WHERE id = ?', [$seriesId]));
    }

    public function testDeletingAllRemovesPastTermsToo(): void
    {
        $admin    = $this->identity($this->adminId, Role::Admin);
        $seriesId = $this->makeSeries($admin);

        $terms = $this->termsOf($seriesId);
        $this->db->run('UPDATE event SET starts_at = DATE_SUB(NOW(), INTERVAL 1 DAY) WHERE id = ?', [$terms[0]]);

        $removal = $this->service->deleteSeries($admin, $seriesId, 'all', null);

        self::assertSame(count($terms), $removal['deleted']);
        self::assertSame(0, $removal['kept']);
        self::assertNull($this->db->value('SELECT id FROM event_series WHERE id = ?', [$seriesId]));
        self::assertNull($this->db->value('SELECT id FROM event WHERE id = ?', [$terms[0]]));
    }

    public function testDeletedTermDoesNotTakeTheMoneyWithIt(): void
    {
        $admin    = $this->identity($this->adminId, Role::Admin);
        $seriesId = $this->makeSeries($admin);
        $terms    = $this->termsOf($seriesId);

        $recordId = $this->makeRecord($this->seasonId, $this->playerMembership);
        $this->db->run('UPDATE offence_record SET event_id = ? WHERE id = ?', [$terms[0], $recordId]);

        $this->service->deleteSeries($admin, $seriesId, 'all', null);

        // Vazba na akci je ON DELETE SET NULL, takže zápis peněz přežije.
        self::assertNotNull($this->db->value('SELECT id FROM offence_record WHERE id = ?', [$recordId]));
        self::assertNull($this->db->value('SELECT event_id FROM offence_record WHERE id = ?', [$recordId]));
    }

    public function testMovingTheTimeKeepsAnswers(): void
    {
        $admin    = $this->identity($this->adminId, Role::Admin);
        $seriesId = $this->makeSeries($admin);
        $terms    = $this->termsOf($seriesId);
        $answered = (int) $this->db->value(
            'SELECT id FROM event WHERE series_id = ? AND starts_at > NOW() ORDER BY starts_at LIMIT 1',
            [$seriesId],
        );

        $this->service->saveRsvp($this->identity($this->playerId, Role::Player), $answered, [
            'rsvp' => 'yes', 'note' => null, 'transport' => 'none', 'carSeats' => null,
        ]);

        $result = $this->service->updateSeries(
            $admin,
            $seriesId,
            [...$this->seriesChanges(), 'startTime' => '18:00'],
            'all',
            null,
        );

        // Data zůstala stejná, termíny se jen upravily — nic se nemazalo.
        self::assertSame(count($terms), $result['updated']);
        self::assertSame(0, $result['created']);
        self::assertSame(0, $result['deleted']);

        self::assertStringContainsString(
            '18:00:00',
            (string) $this->db->value('SELECT starts_at FROM event WHERE id = ?', [$answered]),
        );
        // A hlavně: odpověď hráče u přesunutého termínu přežila.
        self::assertSame(
            'yes',
            (string) $this->db->value(
                'SELECT rsvp FROM event_participant WHERE event_id = ? AND membership_id = ?',
                [$answered, $this->playerMembership],
            ),
        );
    }

    public function testChangingTheRuleFromOneTermSplitsTheSeries(): void
    {
        $admin    = $this->identity($this->adminId, Role::Admin);
        $seriesId = $this->makeSeries($admin);
        $terms    = $this->termsOf($seriesId);

        $third = $terms[2] ?? null;
        self::assertNotNull($third);

        $result = $this->service->updateSeries(
            $admin,
            $seriesId,
            [...$this->seriesChanges(), 'rrule' => 'FREQ=WEEKLY;BYDAY=WE'],
            'following',
            $third,
        );

        // Původní série skončila a od hraničního termínu platí nová.
        self::assertNotSame($seriesId, $result['series']['id']);
        self::assertSame(2, (int) $this->db->value('SELECT COUNT(*) FROM event WHERE series_id = ?', [$seriesId]));
        self::assertGreaterThan(0, $result['created']);
        self::assertGreaterThan(0, $result['deleted']);
    }

    public function testManuallyEditedTermSurvivesBulkChange(): void
    {
        $admin    = $this->identity($this->adminId, Role::Admin);
        $seriesId = $this->makeSeries($admin);
        $terms    = $this->termsOf($seriesId);

        $this->service->update($admin, $terms[1], ['title' => 'Trénink v tělocvičně']);

        $result = $this->service->updateSeries(
            $admin,
            $seriesId,
            [...$this->seriesChanges(), 'startTime' => '18:00'],
            'all',
            null,
        );

        self::assertSame(1, $result['skipped']);
        self::assertSame(
            'Trénink v tělocvičně',
            (string) $this->db->value('SELECT title FROM event WHERE id = ?', [$terms[1]]),
        );
    }

    // ------------------------------------------------------------------ pomůcky

    /**
     * Vlastní řádek volajícího. Je nepovinný (platformní správce v týmu není),
     * takže si ho test musí vytáhnout přes kontrolu, ne rovnou indexem.
     *
     * @param  array{event:array{me:array<string,mixed>|null},...} $detail
     * @return array<string,mixed>
     */
    private function me(array $detail): array
    {
        $me = $detail['event']['me'];

        if ($me === null) {
            self::fail('Volající není v družstvu.');
        }

        return $me;
    }

    /**
     * @param  array{event:array<string,mixed>,participants:list<array<string,mixed>>,canSeeAttendance:bool} $detail
     * @return array<string,mixed>
     */
    private function participant(array $detail, int $membershipId): array
    {
        foreach ($detail['participants'] as $row) {
            if ($row['membershipId'] === $membershipId) {
                return $row;
            }
        }

        self::fail("V akci chybí člen $membershipId.");
    }

    /**
     * @param array{event:array<string,mixed>,participants:list<array<string,mixed>>,canSeeAttendance:bool} $detail
     */
    private function stateOf(array $detail, int $membershipId): ?string
    {
        $attendance = $this->participant($detail, $membershipId)['attendance'];

        return $attendance === null ? null : (string) $attendance;
    }

    /**
     * @param  list<array<string,mixed>> $rows
     * @return array<string,mixed>
     */
    private function rowOf(array $rows, int $membershipId): array
    {
        foreach ($rows as $row) {
            if ($row['membershipId'] === $membershipId) {
                return $row;
            }
        }

        self::fail("V souhrnu chybí člen $membershipId.");
    }

    /** Termíny se počítají od NOW() v minutách, aby testy platily i za rok. */
    private function makeEvent(int $offsetMinutes, string $type = 'training', ?int $seasonId = null): int
    {
        $this->db->run(
            'INSERT INTO event (season_id, type, title, starts_at)
             VALUES (?, ?, ?, DATE_ADD(NOW(), INTERVAL ? MINUTE))',
            [$seasonId ?? $this->seasonId, $type, $type === 'match' ? 'Zápas' : 'Trénink', $offsetMinutes],
        );

        return $this->db->lastInsertId();
    }

    /** Zápas venku: má vzdálenost a místo jinde než domácí halu (ta nastavená není). */
    private function makeAwayMatch(int $offsetMinutes = 2 * self::HOUR): int
    {
        $eventId = $this->makeEvent($offsetMinutes, 'match');
        $this->db->run('UPDATE event SET distance_km = 40 WHERE id = ?', [$eventId]);

        return $eventId;
    }

    /** Série tréninků na září; vrací její ID. */
    private function makeSeries(Identity $admin): int
    {
        $result = $this->service->createSeries($admin, $this->seasonId, $this->seriesInput());

        return $result['series']['id'];
    }

    /**
     * ID termínů série vzestupně podle času.
     *
     * @return list<int>
     */
    private function termsOf(int $seriesId): array
    {
        $rows = $this->db->all('SELECT id FROM event WHERE series_id = ? ORDER BY starts_at', [$seriesId]);

        return array_map(static fn (array $row): int => (int) $row['id'], $rows);
    }

    /**
     * @return array{
     *     title:string,type:string,rrule:string,startTime:string,durationMin:int,
     *     locationId:int|null,meetBeforeMin:int|null,defaultNote:string|null,activeTo:string
     * }
     */
    private function seriesChanges(): array
    {
        $input = $this->seriesInput();
        unset($input['activeFrom']);

        return $input;
    }

    /** Domácí hala je v nastavení družstva, ne u akce. */
    private function setHomeVenue(int $locationId): void
    {
        $this->db->run(
            'INSERT INTO team_settings (team_id, home_location_id) VALUES (?, ?)
             ON DUPLICATE KEY UPDATE home_location_id = VALUES(home_location_id)',
            [$this->teamId, $locationId],
        );
    }

    private function moveEventToPast(int $eventId): void
    {
        $this->db->run('UPDATE event SET starts_at = DATE_SUB(NOW(), INTERVAL 1 HOUR) WHERE id = ?', [$eventId]);
    }

    /**
     * @return array{
     *     type:string,title:string,startsAt:string,endsAt:string|null,meetAt:string|null,
     *     locationId:int|null,opponent:string|null,note:string|null,distanceKm:int|null,
     *     rsvpDeadlineAt:string|null
     * }
     */
    private function eventInput(): array
    {
        return [
            'type'           => 'training',
            'title'          => 'Trénink',
            'startsAt'       => '2026-09-15 19:00:00',
            'endsAt'         => null,
            'meetAt'         => null,
            'locationId'     => $this->locationId,
            'opponent'       => null,
            'note'           => null,
            'distanceKm'     => null,
            'rsvpDeadlineAt' => null,
        ];
    }

    /**
     * @return array{
     *     title:string,type:string,rrule:string,startTime:string,durationMin:int,
     *     locationId:int|null,meetBeforeMin:int|null,defaultNote:string|null,
     *     activeFrom:string,activeTo:string
     * }
     */
    private function seriesInput(): array
    {
        return [
            'title'         => 'Trénink',
            'type'          => 'training',
            'rrule'         => 'FREQ=WEEKLY;BYDAY=TU,TH',
            'startTime'     => '19:00',
            'durationMin'   => 90,
            'locationId'    => $this->locationId,
            'meetBeforeMin' => 15,
            'defaultNote'   => null,
            'activeFrom'    => '2026-09-01',
            'activeTo'      => '2026-09-30',
        ];
    }

    private function identity(int $userId, Role $role): Identity
    {
        return new Identity($userId, "u$userId@prosek.cz", "u$userId", false, [$this->teamId => $role]);
    }

    private function expectStatus(int $status, callable $call): void
    {
        try {
            $call();
            self::fail("Očekával jsem chybu $status.");
        } catch (ApiException $e) {
            self::assertSame($status, $e->status, $e->getMessage());
        }
    }
}
