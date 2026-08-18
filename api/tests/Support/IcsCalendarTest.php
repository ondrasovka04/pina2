<?php

declare(strict_types=1);

namespace Pina\Tests\Support;

use PHPUnit\Framework\TestCase;
use Pina\Support\IcsCalendar;

final class IcsCalendarTest extends TestCase
{
    private IcsCalendar $calendar;

    protected function setUp(): void
    {
        $this->calendar = new IcsCalendar();
    }

    /** Místní 19:00 letního času je 17:00 UTC; bez zóny by čas ujel podle telefonu. */
    public function testBuildsCalendarWithStableUidAndAbsoluteTime(): void
    {
        $ics   = $this->calendar->build([$this->event()], 'Prosek – muži', '26/27');
        $lines = $this->unfold($ics);

        self::assertSame('BEGIN:VCALENDAR', $lines[0]);
        self::assertContains('UID:pina-event-42@pinaprosek.eu', $lines);
        self::assertContains('DTSTART:20260915T170000Z', $lines);
        self::assertContains('DTEND:20260915T183000Z', $lines);
        self::assertContains('DTSTAMP:20260816T120000Z', $lines);
        self::assertContains('REFRESH-INTERVAL;VALUE=DURATION:PT1H', $lines);
        self::assertContains('X-WR-CALNAME:Prosek – muži – 26/27', $lines);
        self::assertSame('END:VCALENDAR', $lines[array_key_last($lines)]);
        self::assertStringEndsWith("\r\n", $ics);
    }

    public function testEscapesLocationAndDescription(): void
    {
        $event                    = $this->event();
        $event['locationName']    = 'Hala; Prosek';
        $event['locationAddress'] = 'Prosecká 1, Praha';
        $event['opponent']        = 'Slavia; Praha, B-tým';
        $event['meetAt']          = '2026-09-15 18:30:00';

        $lines = $this->unfold($this->calendar->build([$event], 'Prosek', '26/27'));

        self::assertContains('LOCATION:Hala\; Prosek\, Prosecká 1\, Praha', $lines);
        self::assertContains('DESCRIPTION:Soupeř: Slavia\; Praha\, B-tým\nSraz: 18:30', $lines);
    }

    public function testCancelledEventAndExplicitEnd(): void
    {
        $event           = $this->event();
        $event['status'] = 'cancelled';
        $event['endsAt'] = '2026-09-15 21:15:00';

        $lines = $this->unfold($this->calendar->build([$event], 'Prosek', '26/27'));

        self::assertContains('DTEND:20260915T191500Z', $lines);
        self::assertContains('STATUS:CANCELLED', $lines);
    }

    public function testFoldsLongUtf8LinesAtSeventyFiveOctets(): void
    {
        $event          = $this->event();
        $event['title'] = str_repeat('Příliš žluťoučký kůň ', 8);

        $ics = $this->calendar->build([$event], 'Prosek', '26/27');

        foreach (array_filter(explode("\r\n", $ics)) as $line) {
            self::assertLessThanOrEqual(75, strlen($line), $line);
        }
    }

    /**
     * @return array{
     *     id:int,title:string,startsAt:string,endsAt:string|null,meetAt:string|null,
     *     locationName:string|null,locationAddress:string|null,opponent:string|null,
     *     status:string,createdAt:string
     * }
     */
    private function event(): array
    {
        return [
            'id'              => 42,
            'title'           => 'Trénink',
            'startsAt'        => '2026-09-15 19:00:00',
            'endsAt'          => null,
            'meetAt'          => null,
            'locationName'    => null,
            'locationAddress' => null,
            'opponent'        => null,
            'status'          => 'planned',
            'createdAt'       => '2026-08-16 14:00:00',
        ];
    }

    /** @return list<string> */
    private function unfold(string $ics): array
    {
        $result = [];

        foreach (explode("\r\n", $ics) as $line) {
            if (str_starts_with($line, ' ') && $result !== []) {
                $last = array_key_last($result);
                $result[$last] .= substr($line, 1);
            } elseif ($line !== '') {
                $result[] = $line;
            }
        }

        return $result;
    }
}
