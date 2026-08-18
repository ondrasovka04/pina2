<?php

declare(strict_types=1);

namespace Pina\Tests\Integration;

use Pina\Auth\Identity;
use Pina\Auth\Role;
use Pina\Auth\TeamScope;
use Pina\Controller\CalendarFeedController;
use Pina\Http\ApiException;
use Pina\Http\Request;
use Pina\Service\CalendarFeedService;
use Pina\Support\IcsCalendar;

final class CalendarFeedServiceTest extends DatabaseTestCase
{
    private CalendarFeedService $service;
    private int $teamId;
    private int $seasonId;
    private int $userId;
    private int $membershipId;

    protected function setUp(): void
    {
        parent::setUp();

        [, $this->teamId]   = $this->makeTeam('prosek', 'Muži');
        $this->seasonId     = $this->makeSeason($this->teamId, '26/27');
        $this->userId       = $this->makeUser('hrac@prosek.cz');
        $this->membershipId = $this->makeMembership($this->userId, $this->teamId, 'player');

        $this->service = new CalendarFeedService($this->db, new TeamScope($this->db), new IcsCalendar());
    }

    public function testIssueStoresOnlyHashAndListsFeedWithoutToken(): void
    {
        $issued = $this->service->issue($this->identity(), $this->seasonId);

        self::assertMatchesRegularExpression('/^[a-f0-9]{64}$/', $issued['token']);

        $stored = $this->db->first('SELECT token_hash FROM calendar_feed WHERE id = ?', [$issued['id']]);
        self::assertNotNull($stored);
        self::assertSame(hash('sha256', $issued['token']), $stored['token_hash']);
        self::assertNotSame($issued['token'], $stored['token_hash']);

        $feeds = $this->service->list($this->identity());
        self::assertCount(1, $feeds);
        self::assertArrayNotHasKey('token', $feeds[0]);
        self::assertSame($this->seasonId, $feeds[0]['seasonId']);
    }

    public function testValidTokenReturnsSafeCalendar(): void
    {
        $this->db->run(
            'INSERT INTO event (season_id, type, title, starts_at, meet_at, opponent, note)
             VALUES (?, ?, ?, ?, ?, ?, ?)',
            [
                $this->seasonId,
                'match',
                'Zápas',
                '2026-09-15 19:00:00',
                '2026-09-15 18:30:00',
                'Slavia',
                'Pepík dluží 500 Kč a nejede',
            ],
        );

        $issued   = $this->service->issue($this->identity(), $this->seasonId);
        $document = $this->service->document($issued['token'], null);

        self::assertFalse($document['notModified']);
        self::assertStringContainsString('UID:pina-event-', $document['body']);
        self::assertStringContainsString('Soupeř: Slavia', $document['body']);
        self::assertStringContainsString('Sraz: 18:30', $document['body']);
        self::assertStringNotContainsString('Pepík', $document['body']);
        self::assertStringNotContainsString('500', $document['body']);
        self::assertNotNull($this->db->value('SELECT last_used_at FROM calendar_feed WHERE id = ?', [$issued['id']]));
    }

    public function testMatchingEtagReturnsNotModified(): void
    {
        $issued = $this->service->issue($this->identity(), $this->seasonId);
        $first  = $this->service->document($issued['token'], null);
        $this->allowNextFetch($issued['id']);
        $second = $this->service->document($issued['token'], $first['etag']);

        self::assertTrue($second['notModified']);
        self::assertSame($first['etag'], $second['etag']);
        self::assertSame($first['body'], $second['body']);
    }

    public function testPublicControllerReturnsCalendarAndThen304(): void
    {
        $issued     = $this->service->issue($this->identity(), $this->seasonId);
        $controller = new CalendarFeedController($this->service);

        $firstRequest                       = new Request('GET', '/calendar', [], [], [], '127.0.0.1');
        $firstRequest->routeParams['token'] = $issued['token'];
        $first                              = $controller->show($firstRequest);

        self::assertSame(200, $first->status);
        self::assertSame('text/calendar; charset=utf-8', $first->contentType);
        self::assertStringStartsWith('BEGIN:VCALENDAR', $first->rawBody ?? '');

        $this->allowNextFetch($issued['id']);

        $secondRequest = new Request(
            'GET',
            '/calendar',
            [],
            [],
            ['if-none-match' => $first->headers['ETag']],
            '127.0.0.1',
        );
        $secondRequest->routeParams['token'] = $issued['token'];
        $second                              = $controller->show($secondRequest);

        self::assertSame(304, $second->status);
        self::assertSame('text/calendar; charset=utf-8', $second->contentType);
        self::assertNull($second->rawBody);
        self::assertSame($first->headers['ETag'], $second->headers['ETag']);
    }

    public function testRepeatedFullFetchIsRateLimited(): void
    {
        $issued = $this->service->issue($this->identity(), $this->seasonId);
        $this->service->document($issued['token'], null);

        $this->expectStatus(429, fn () => $this->service->document($issued['token'], null));
    }

    public function testRevokedTokenIsNotFound(): void
    {
        $issued = $this->service->issue($this->identity(), $this->seasonId);
        $this->service->revoke($this->identity(), $issued['id']);

        $this->expectStatus(404, fn () => $this->service->document($issued['token'], null));
    }

    public function testEndedMembershipCannotReadFeed(): void
    {
        $issued = $this->service->issue($this->identity(), $this->seasonId);
        $this->db->run("UPDATE membership SET status = 'left' WHERE id = ?", [$this->membershipId]);

        $this->expectStatus(404, fn () => $this->service->document($issued['token'], null));
    }

    public function testStoredHashCannotReplaceToken(): void
    {
        $issued = $this->service->issue($this->identity(), $this->seasonId);
        $hash   = (string) $this->db->value('SELECT token_hash FROM calendar_feed WHERE id = ?', [$issued['id']]);

        $this->expectStatus(404, fn () => $this->service->document($hash, null));
    }

    public function testNewFeedRevokesPreviousOne(): void
    {
        $first  = $this->service->issue($this->identity(), $this->seasonId);
        $second = $this->service->issue($this->identity(), $this->seasonId);

        self::assertNotSame($first['token'], $second['token']);
        $this->expectStatus(404, fn () => $this->service->document($first['token'], null));
        self::assertCount(1, $this->service->list($this->identity()));
    }

    public function testPlatformAdminWithoutMembershipCannotIssueFeed(): void
    {
        $platformId = $this->makeUser('spravce@pina.cz');
        $identity   = new Identity($platformId, 'spravce@pina.cz', 'Správce', true, []);

        $this->expectStatus(404, fn () => $this->service->issue($identity, $this->seasonId));
    }

    private function identity(): Identity
    {
        return new Identity(
            $this->userId,
            'hrac@prosek.cz',
            'Hráč',
            false,
            [$this->teamId => Role::Player],
        );
    }

    private function allowNextFetch(int $feedId): void
    {
        $this->db->run(
            'UPDATE calendar_feed SET last_used_at = DATE_SUB(NOW(), INTERVAL 3 SECOND) WHERE id = ?',
            [$feedId],
        );
    }

    private function expectStatus(int $status, callable $call): void
    {
        try {
            $call();
            self::fail("Očekával jsem chybu $status.");
        } catch (ApiException $exception) {
            self::assertSame($status, $exception->status, $exception->getMessage());
        }
    }
}
