<?php

declare(strict_types=1);

namespace Pina\Support;

use DateInterval;
use DateTimeImmutable;
use DateTimeZone;
use Pina\Http\ApiException;

/**
 * Rozbaluje iCalendar RRULE (RFC 5545, jen podmnožina) na konkrétní data.
 *
 * Používá se při zakládání opakované série tréninků — z pravidla
 * „každé úterý a čtvrtek" se vyrobí desítky konkrétních termínů v sezóně.
 */
final class Recurrence
{
    /** ISO číslo dne v týdnu (pondělí = 1) podle zkratky použité v BYDAY. */
    private const WEEKDAYS = [
        'MO' => 1,
        'TU' => 2,
        'WE' => 3,
        'TH' => 4,
        'FR' => 5,
        'SA' => 6,
        'SU' => 7,
    ];

    /** Klíče, kterým rozumíme; cokoli jiného je nepodporované pravidlo. */
    private const ALLOWED_KEYS = ['FREQ', 'INTERVAL', 'COUNT', 'UNTIL', 'BYDAY'];

    /**
     * Rozbalí RRULE na konkrétní data v uzavřeném intervalu <$from, $to>.
     *
     * @param  string $rrule např. "FREQ=WEEKLY;BYDAY=TU,TH" nebo "FREQ=WEEKLY;INTERVAL=2;BYDAY=MO"
     * @param  string $from  RRRR-MM-DD včetně
     * @param  string $to    RRRR-MM-DD včetně
     * @return list<string>  data RRRR-MM-DD vzestupně, bez duplicit
     */
    public static function dates(string $rrule, string $from, string $to, int $limit = 400): array
    {
        $fromDate = self::parseDate($from, 'od');
        $toDate   = self::parseDate($to, 'do');

        if ($fromDate > $toDate) {
            throw ApiException::validation(
                'Počátek intervalu musí být nejdříve v den, kdy interval končí.',
                ['field' => 'rrule'],
            );
        }

        $parts = self::parseRule($rrule);

        foreach (array_keys($parts) as $key) {
            if (!in_array($key, self::ALLOWED_KEYS, true)) {
                throw ApiException::validation("Nepodporovaný parametr pravidla: {$key}.", ['field' => 'rrule']);
            }
        }

        $freq = isset($parts['FREQ']) ? strtoupper($parts['FREQ']) : null;
        if ($freq === null || !in_array($freq, ['WEEKLY', 'DAILY'], true)) {
            throw ApiException::validation('Podporuje se jen FREQ=WEEKLY nebo FREQ=DAILY.', ['field' => 'rrule']);
        }

        if ($freq === 'DAILY' && isset($parts['BYDAY'])) {
            throw ApiException::validation('BYDAY jde použít jen s FREQ=WEEKLY.', ['field' => 'rrule']);
        }

        $interval = self::parseInterval($parts['INTERVAL'] ?? null);
        $count    = self::parseCount($parts['COUNT'] ?? null);
        $until    = self::parseUntil($parts['UNTIL'] ?? null);

        // UNTIL i $to platí obě zároveň — bere se ten dřívější konec.
        $end = $until !== null && $until < $toDate ? $until : $toDate;

        return $freq === 'WEEKLY'
            ? self::weekly($fromDate, $end, $interval, $parts['BYDAY'] ?? null, $count, $limit)
            : self::daily($fromDate, $end, $interval, $count, $limit);
    }

    /** @return list<string> */
    private static function daily(
        DateTimeImmutable $from,
        DateTimeImmutable $end,
        int $interval,
        ?int $count,
        int $limit,
    ): array {
        $dates  = [];
        $cursor = $from;
        $step   = new DateInterval("P{$interval}D");

        while ($cursor <= $end) {
            $dates[] = $cursor->format('Y-m-d');

            if (self::shouldStop($dates, $count, $limit)) {
                break;
            }

            $cursor = $cursor->add($step);
        }

        return $dates;
    }

    /** @return list<string> */
    private static function weekly(
        DateTimeImmutable $from,
        DateTimeImmutable $end,
        int $interval,
        ?string $byDay,
        ?int $count,
        int $limit,
    ): array {
        $weekdays = self::parseByDay($byDay, $from);

        // Týdny se při INTERVAL > 1 počítají od pondělí týdne, ve kterém leží $from.
        $anchorMonday = self::mondayOf($from);

        $dates  = [];
        $cursor = $from;
        $oneDay = new DateInterval('P1D');

        while ($cursor <= $end) {
            $isoWeekday = (int) $cursor->format('N');

            if (in_array($isoWeekday, $weekdays, true)) {
                $weeksDiff = intdiv($anchorMonday->diff(self::mondayOf($cursor))->days, 7);

                if ($weeksDiff % $interval === 0) {
                    $dates[] = $cursor->format('Y-m-d');

                    if (self::shouldStop($dates, $count, $limit)) {
                        break;
                    }
                }
            }

            $cursor = $cursor->add($oneDay);
        }

        return $dates;
    }

    /** @param list<string> $dates */
    private static function shouldStop(array $dates, ?int $count, int $limit): bool
    {
        $generated = count($dates);

        return $generated >= $limit || ($count !== null && $generated >= $count);
    }

    /** Pondělí týdne, ve kterém $date leží (týden začíná pondělkem, jako v ISO 8601). */
    private static function mondayOf(DateTimeImmutable $date): DateTimeImmutable
    {
        $isoWeekday = (int) $date->format('N');

        return $isoWeekday === 1 ? $date : $date->sub(new DateInterval('P' . ($isoWeekday - 1) . 'D'));
    }

    /**
     * Rozloží RRULE na páry klíč => hodnota. Klíče jsou case-insensitive,
     * mezery kolem klíče i hodnoty se ignorují, pořadí částí je libovolné.
     *
     * @return array<string,string>
     */
    private static function parseRule(string $rrule): array
    {
        $parts = [];

        foreach (explode(';', $rrule) as $chunk) {
            $chunk = trim($chunk);
            if ($chunk === '') {
                continue;
            }

            if (!str_contains($chunk, '=')) {
                throw ApiException::validation("Neplatná část pravidla: {$chunk}.", ['field' => 'rrule']);
            }

            [$key, $value]                 = explode('=', $chunk, 2);
            $parts[strtoupper(trim($key))] = trim($value);
        }

        return $parts;
    }

    private static function parseInterval(?string $value): int
    {
        if ($value === null) {
            return 1;
        }

        if (!ctype_digit($value) || (int) $value < 1) {
            throw ApiException::validation(
                "INTERVAL musí být kladné celé číslo, dostal jsem „{$value}\".",
                ['field' => 'rrule'],
            );
        }

        return (int) $value;
    }

    private static function parseCount(?string $value): ?int
    {
        if ($value === null) {
            return null;
        }

        if (!ctype_digit($value) || (int) $value < 1) {
            throw ApiException::validation(
                "COUNT musí být kladné celé číslo, dostal jsem „{$value}\".",
                ['field' => 'rrule'],
            );
        }

        return (int) $value;
    }

    private static function parseUntil(?string $value): ?DateTimeImmutable
    {
        if ($value === null) {
            return null;
        }

        // Podporujeme RRRR-MM-DD i ical tvar 20260630 / 20260630T000000Z.
        if (preg_match('/^\d{4}-\d{2}-\d{2}$/', $value) === 1) {
            return self::parseDate($value, 'UNTIL');
        }

        if (preg_match('/^(\d{4})(\d{2})(\d{2})(T\d{6}Z)?$/', $value, $m) === 1) {
            return self::parseDate("{$m[1]}-{$m[2]}-{$m[3]}", 'UNTIL');
        }

        throw ApiException::validation("Neplatné UNTIL: „{$value}\".", ['field' => 'rrule']);
    }

    /** @return list<int> ISO čísla dnů v týdnu (pondělí = 1), bez duplicit. */
    private static function parseByDay(?string $byDay, DateTimeImmutable $from): array
    {
        if ($byDay === null) {
            return [(int) $from->format('N')];
        }

        $weekdays = [];
        foreach (explode(',', $byDay) as $token) {
            $token = strtoupper(trim($token));

            if (!isset(self::WEEKDAYS[$token])) {
                throw ApiException::validation("Neznámý den v BYDAY: „{$token}\".", ['field' => 'rrule']);
            }

            $weekdays[] = self::WEEKDAYS[$token];
        }

        return array_values(array_unique($weekdays));
    }

    private static function parseDate(string $value, string $label): DateTimeImmutable
    {
        $date = DateTimeImmutable::createFromFormat('!Y-m-d', $value, new DateTimeZone('Europe/Prague'));

        // Kontrola zpětným formátováním odchytí i kalendářně neplatná data (např. 30. únor),
        // která by DateTimeImmutable jinak tiše přetekla do jiného měsíce.
        if ($date === false || $date->format('Y-m-d') !== $value) {
            throw ApiException::validation("Neplatné datum ({$label}): „{$value}\".", ['field' => 'rrule']);
        }

        return $date;
    }
}
