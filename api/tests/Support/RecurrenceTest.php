<?php

declare(strict_types=1);

namespace Pina\Tests\Support;

use Pina\Http\ApiException;
use Pina\Support\Recurrence;
use PHPUnit\Framework\Attributes\DataProvider;
use PHPUnit\Framework\TestCase;

final class RecurrenceTest extends TestCase
{
    public function testTwiceAWeekAcrossMonths(): void
    {
        // "Každé úterý a čtvrtek" přes tři měsíce — přesně scénář zakládání sezónní série tréninků.
        $dates = Recurrence::dates('FREQ=WEEKLY;BYDAY=TU,TH', '2026-09-01', '2026-11-30');

        self::assertCount(26, $dates);
        self::assertSame(['2026-09-01', '2026-09-03', '2026-09-08'], array_slice($dates, 0, 3));
        self::assertSame(['2026-11-19', '2026-11-24', '2026-11-26'], array_slice($dates, -3));

        // Vzestupně, bez duplicit, a jen úterky (2) nebo čtvrtky (4).
        self::assertSame($dates, self::sortedUnique($dates));
        foreach ($dates as $date) {
            $weekday = (int) (new \DateTimeImmutable($date))->format('N');
            self::assertContains($weekday, [2, 4], "{$date} není úterý ani čtvrtek");
        }
    }

    public function testWeeklyWithoutByDayUsesWeekdayOfFrom(): void
    {
        // Bez BYDAY se bere den v týdnu podle $from — 2026-01-05 je pondělí.
        $dates = Recurrence::dates('FREQ=WEEKLY', '2026-01-05', '2026-01-26');

        self::assertSame(['2026-01-05', '2026-01-12', '2026-01-19', '2026-01-26'], $dates);
    }

    public function testIntervalTwoCountsWeeksFromMondayOfFrom(): void
    {
        // FREQ=WEEKLY;INTERVAL=2;BYDAY=MO — každé druhé pondělí, počítáno od týdne, ve kterém leží $from.
        $dates = Recurrence::dates('FREQ=WEEKLY;INTERVAL=2;BYDAY=MO', '2026-09-07', '2026-11-02');

        self::assertSame(
            ['2026-09-07', '2026-09-21', '2026-10-05', '2026-10-19', '2026-11-02'],
            $dates,
        );
    }

    public function testDailyWithInterval(): void
    {
        $dates = Recurrence::dates('FREQ=DAILY;INTERVAL=3', '2026-01-01', '2026-01-10');

        self::assertSame(['2026-01-01', '2026-01-04', '2026-01-07', '2026-01-10'], $dates);
    }

    public function testCountStopsGenerationEarly(): void
    {
        $dates = Recurrence::dates('FREQ=WEEKLY;BYDAY=MO,WE,FR;COUNT=5', '2026-01-05', '2026-02-28');

        self::assertSame(
            ['2026-01-05', '2026-01-07', '2026-01-09', '2026-01-12', '2026-01-14'],
            $dates,
        );
    }

    public function testUntilEarlierThanToWins(): void
    {
        // UNTIL i $to platí obě — bere se dřívější, takže výsledek končí 5. ledna, ne 31.
        $dates = Recurrence::dates('FREQ=DAILY;UNTIL=20260105', '2026-01-01', '2026-01-31');

        self::assertSame(
            ['2026-01-01', '2026-01-02', '2026-01-03', '2026-01-04', '2026-01-05'],
            $dates,
        );
    }

    public function testUntilAcceptsIcalDateTimeForm(): void
    {
        $dates = Recurrence::dates('FREQ=DAILY;UNTIL=20260103T000000Z', '2026-01-01', '2026-01-31');

        self::assertSame(['2026-01-01', '2026-01-02', '2026-01-03'], $dates);
    }

    public function testLimitStopsGenerationAsSafetyNet(): void
    {
        // $limit je pojistka, ne chyba — vrátí prvních pár dat, nezhroutí se na celoroční interval.
        $dates = Recurrence::dates('FREQ=DAILY', '2026-01-01', '2026-12-31', limit: 5);

        self::assertSame(
            ['2026-01-01', '2026-01-02', '2026-01-03', '2026-01-04', '2026-01-05'],
            $dates,
        );
    }

    public function testBothBoundsAreInclusive(): void
    {
        self::assertSame(['2026-01-01'], Recurrence::dates('FREQ=DAILY', '2026-01-01', '2026-01-01'));
        self::assertSame(
            ['2026-01-05', '2026-01-12'],
            Recurrence::dates('FREQ=WEEKLY;BYDAY=MO', '2026-01-05', '2026-01-12'),
        );
    }

    public function testDstTransitionInLateMarchDoesNotSkipOrDuplicateSunday(): void
    {
        // V ČR se v neděli 29. 3. 2026 posouvají hodiny na letní čas ve 2:00 na 3:00.
        // Počítání po timestampech (pevných 24 h) by tenhle týden přeskočilo nebo zdvojilo.
        $dates = Recurrence::dates('FREQ=WEEKLY;BYDAY=SU', '2026-03-01', '2026-04-05');

        self::assertSame(
            ['2026-03-01', '2026-03-08', '2026-03-15', '2026-03-22', '2026-03-29', '2026-04-05'],
            $dates,
        );
    }

    public function testRuleParsingIsCaseInsensitiveWhitespaceTolerantAndOrderIndependent(): void
    {
        $dates = Recurrence::dates(' byday = mo ; freq = weekly ', '2026-01-05', '2026-01-12');

        self::assertSame(['2026-01-05', '2026-01-12'], $dates);
    }

    /** @return array<string,array{string,string,string}> */
    public static function invalidInputProvider(): array
    {
        return [
            'chybí FREQ'                          => ['BYDAY=MO', '2026-01-01', '2026-01-31'],
            'neznámá FREQ'                         => ['FREQ=MONTHLY', '2026-01-01', '2026-01-31'],
            'prázdné BYDAY'                        => ['FREQ=WEEKLY;BYDAY=', '2026-01-01', '2026-01-31'],
            'neznámý den v BYDAY'                  => ['FREQ=WEEKLY;BYDAY=XX', '2026-01-01', '2026-01-31'],
            'BYDAY nejde s DAILY'                  => ['FREQ=DAILY;BYDAY=MO', '2026-01-01', '2026-01-31'],
            'INTERVAL nula'                        => ['FREQ=WEEKLY;INTERVAL=0', '2026-01-01', '2026-01-31'],
            'INTERVAL záporný'                     => ['FREQ=WEEKLY;INTERVAL=-1', '2026-01-01', '2026-01-31'],
            'INTERVAL není číslo'                  => ['FREQ=WEEKLY;INTERVAL=abc', '2026-01-01', '2026-01-31'],
            'COUNT nula'                           => ['FREQ=WEEKLY;COUNT=0', '2026-01-01', '2026-01-31'],
            'neplatné UNTIL'                       => ['FREQ=DAILY;UNTIL=not-a-date', '2026-01-01', '2026-01-31'],
            'nepodporovaný klíč'                   => ['FREQ=DAILY;FOO=BAR', '2026-01-01', '2026-01-31'],
            '$from po $to'                         => ['FREQ=DAILY', '2026-01-31', '2026-01-01'],
            'neplatné kalendářní datum $from'      => ['FREQ=DAILY', '2026-02-30', '2026-03-01'],
            'neplatné kalendářní datum $to'        => ['FREQ=DAILY', '2026-01-01', '2026-02-30'],
        ];
    }

    #[DataProvider('invalidInputProvider')]
    public function testInvalidInputsThrowValidationError(string $rrule, string $from, string $to): void
    {
        try {
            Recurrence::dates($rrule, $from, $to);
            self::fail('Očekávala se ApiException::validation().');
        } catch (ApiException $e) {
            self::assertSame(400, $e->status);
            self::assertSame('VALIDATION_FAILED', $e->errorCode);
            self::assertSame('rrule', $e->details['field'] ?? null);
        }
    }

    /**
     * @param  list<string> $dates
     * @return list<string>
     */
    private static function sortedUnique(array $dates): array
    {
        $unique = array_values(array_unique($dates));
        sort($unique);

        return $unique;
    }
}
