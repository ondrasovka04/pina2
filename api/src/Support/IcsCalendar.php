<?php

declare(strict_types=1);

namespace Pina\Support;

use DateInterval;
use DateTimeImmutable;
use DateTimeZone;

/**
 * Serverový generátor odběru kalendáře podle RFC 5545.
 *
 * @phpstan-type CalendarEvent array{
 *     id:int,
 *     title:string,
 *     startsAt:string,
 *     endsAt:string|null,
 *     meetAt:string|null,
 *     locationName:string|null,
 *     locationAddress:string|null,
 *     opponent:string|null,
 *     status:string,
 *     createdAt:string
 * }
 */
final class IcsCalendar
{
    private const PRODID = '-//Pina//Pina 2.0//CS';

    /**
     * Jak často se má kalendář ptát. Je to jen doporučení — Apple a Outlook ho
     * respektují, Google si drží vlastní interval v řádu hodin. Bez něj se ale
     * některé kalendáře ptají řádově vzácněji a přesunutý trénink by se
     * v telefonu neobjevil včas.
     */
    private const REFRESH_INTERVAL = 'PT1H';

    private const DEFAULT_DURATION   = 90;
    private const FIRST_LINE_LIMIT   = 75;
    private const CONTINUATION_LIMIT = 74;

    /**
     * @param list<CalendarEvent> $events
     */
    public function build(array $events, string $teamName, string $seasonName): string
    {
        $lines = [
            'BEGIN:VCALENDAR',
            'VERSION:2.0',
            'PRODID:' . self::PRODID,
            'CALSCALE:GREGORIAN',
            'REFRESH-INTERVAL;VALUE=DURATION:' . self::REFRESH_INTERVAL,
            'X-PUBLISHED-TTL:' . self::REFRESH_INTERVAL,
            $this->contentLine('X-WR-CALNAME', $this->escapeText($teamName . ' – ' . $seasonName)),
        ];

        foreach ($events as $event) {
            array_push($lines, ...$this->eventLines($event, $teamName));
        }

        $lines[] = 'END:VCALENDAR';

        return implode("\r\n", $lines) . "\r\n";
    }

    /**
     * @param  CalendarEvent $event
     * @return list<string>
     */
    private function eventLines(array $event, string $teamName): array
    {
        $endsAt = $event['endsAt'] ?? (new DateTimeImmutable($event['startsAt']))
            ->add(new DateInterval('PT' . self::DEFAULT_DURATION . 'M'))
            ->format('Y-m-d H:i:s');

        $lines = [
            'BEGIN:VEVENT',
            $this->contentLine('UID', 'pina-event-' . $event['id'] . '@pinaprosek.eu'),
            $this->contentLine('DTSTAMP', $this->formatUtc($event['createdAt'])),
            $this->contentLine('DTSTART', $this->formatUtc($event['startsAt'])),
            $this->contentLine('DTEND', $this->formatUtc($endsAt)),
            $this->contentLine('SUMMARY', $this->escapeText($teamName . ' – ' . $event['title'])),
        ];

        $location = $this->location($event['locationName'], $event['locationAddress']);
        if ($location !== null) {
            $lines[] = $this->contentLine('LOCATION', $this->escapeText($location));
        }

        $description = $this->description($event['opponent'], $event['meetAt']);
        if ($description !== null) {
            $lines[] = $this->contentLine('DESCRIPTION', $this->escapeText($description));
        }

        $lines[] = $this->contentLine('STATUS', $event['status'] === 'cancelled' ? 'CANCELLED' : 'CONFIRMED');
        $lines[] = 'END:VEVENT';

        return $lines;
    }

    /**
     * Časy se posílají v UTC, ne jako „plovoucí" bez zóny. Plovoucí čas si
     * kalendář vyloží ve své vlastní zóně, takže hráč s telefonem přepnutým na
     * cizí zónu — nebo Google kalendář, který zónu Prahy nastavenou nemá —
     * by měl trénink o hodiny jinde. V databázi je místní čas Prahy, přepočet
     * proto respektuje i letní čas daného dne.
     */
    private function formatUtc(string $value): string
    {
        return (new DateTimeImmutable($value, new DateTimeZone('Europe/Prague')))
            ->setTimezone(new DateTimeZone('UTC'))
            ->format('Ymd\THis\Z');
    }

    private function location(?string $name, ?string $address): ?string
    {
        if ($name === null) {
            return null;
        }

        $address = trim($address ?? '');

        return $address === '' ? $name : $name . ', ' . $address;
    }

    private function description(?string $opponent, ?string $meetAt): ?string
    {
        $parts = [];

        if ($opponent !== null) {
            $parts[] = 'Soupeř: ' . $opponent;
        }

        if ($meetAt !== null) {
            $parts[] = 'Sraz: ' . (new DateTimeImmutable($meetAt))->format('H:i');
        }

        return $parts === [] ? null : implode("\n", $parts);
    }

    private function escapeText(string $value): string
    {
        return str_replace(
            ['\\', ';', ',', "\r\n", "\n", "\r"],
            ['\\\\', '\\;', '\\,', '\\n', '\\n', '\\n'],
            $value,
        );
    }

    private function contentLine(string $name, string $value): string
    {
        return $this->foldLine($name . ':' . $value);
    }

    /** RFC 5545 počítá limit v oktetech UTF-8, ne ve znacích. */
    private function foldLine(string $line): string
    {
        $characters = preg_split('//u', $line, -1, PREG_SPLIT_NO_EMPTY);
        if ($characters === false) {
            return $line;
        }

        $rows         = [];
        $current      = '';
        $currentBytes = 0;
        $limit        = self::FIRST_LINE_LIMIT;

        foreach ($characters as $character) {
            $bytes = strlen($character);

            if ($current !== '' && $currentBytes + $bytes > $limit) {
                $rows[]       = $current;
                $current      = '';
                $currentBytes = 0;
                $limit        = self::CONTINUATION_LIMIT;
            }

            $current .= $character;
            $currentBytes += $bytes;
        }

        $rows[] = $current;

        return implode("\r\n ", $rows);
    }
}
