<?php

declare(strict_types=1);

namespace Pina\Controller;

use DateTimeImmutable;
use Pina\Http\ApiException;
use Pina\Http\Request;
use Pina\Http\Response;
use Pina\Service\EventService;

/** Kalendář, akce, série a docházka. */
final class EventController
{
    public function __construct(private readonly EventService $events)
    {
    }

    public function index(Request $request): Response
    {
        return Response::ok([
            'events' => $this->events->calendar(
                $request->identity(),
                $request->routeId('season'),
                $this->queryDate($request, 'from'),
                $this->queryDate($request, 'to'),
            ),
        ]);
    }

    public function show(Request $request): Response
    {
        return Response::ok($this->events->detail($request->identity(), $request->routeId('id')));
    }

    public function store(Request $request): Response
    {
        $event = $this->events->create($request->identity(), $request->routeId('season'), [
            'type'               => $request->string('type', 'training'),
            'title'              => $this->title($request),
            'startsAt'           => $this->dateTime($request, 'startsAt'),
            'endsAt'             => $this->optionalDateTime($request, 'endsAt'),
            'meetAt'             => $this->optionalDateTime($request, 'meetAt'),
            'locationId'         => $request->optionalSignedInt('locationId'),
            'opponent'           => $request->optionalString('opponent'),
            'note'               => $request->optionalString('note'),
            'distanceKm'         => $this->distance($request),
            'nominationDeadline' => $this->optionalDateTime($request, 'nominationDeadline'),
        ]);

        return Response::created($event);
    }

    public function update(Request $request): Response
    {
        $changes = [];

        foreach (['type', 'title', 'status', 'opponent', 'note'] as $key) {
            if (array_key_exists($key, $request->body)) {
                $changes[$key] = $request->optionalString($key);
            }
        }

        foreach (['startsAt', 'endsAt', 'meetAt', 'nominationDeadline'] as $key) {
            if (array_key_exists($key, $request->body)) {
                $changes[$key] = $this->optionalDateTime($request, $key);
            }
        }

        foreach (['locationId', 'distanceKm'] as $key) {
            if (array_key_exists($key, $request->body)) {
                $changes[$key] = $request->optionalSignedInt($key);
            }
        }

        return Response::ok($this->events->update($request->identity(), $request->routeId('id'), $changes));
    }

    public function cancel(Request $request): Response
    {
        return Response::ok($this->events->cancel($request->identity(), $request->routeId('id')));
    }

    public function restore(Request $request): Response
    {
        return Response::ok($this->events->restore($request->identity(), $request->routeId('id')));
    }

    public function delete(Request $request): Response
    {
        $this->events->delete($request->identity(), $request->routeId('id'));

        return Response::noContent();
    }

    public function series(Request $request): Response
    {
        return Response::ok([
            'series' => $this->events->series($request->identity(), $request->routeId('season')),
        ]);
    }

    public function storeSeries(Request $request): Response
    {
        $result = $this->events->createSeries($request->identity(), $request->routeId('season'), [
            'title'         => $this->title($request),
            'type'          => $request->string('type', 'training'),
            'rrule'         => $request->string('rrule'),
            'startTime'     => $this->time($request, 'startTime'),
            'durationMin'   => $this->duration($request),
            'locationId'    => $request->optionalSignedInt('locationId'),
            'meetBeforeMin' => $this->meetBefore($request),
            'defaultNote'   => $request->optionalString('defaultNote'),
            'activeFrom'    => $this->date($request, 'activeFrom'),
            'activeTo'      => $this->date($request, 'activeTo'),
        ]);

        return Response::created($result);
    }

    public function updateSeries(Request $request): Response
    {
        $result = $this->events->updateSeries(
            $request->identity(),
            $request->routeId('id'),
            [
                'title'         => $this->title($request),
                'type'          => $request->string('type', 'training'),
                'rrule'         => $request->string('rrule'),
                'startTime'     => $this->time($request, 'startTime'),
                'durationMin'   => $this->duration($request),
                'locationId'    => $request->optionalSignedInt('locationId'),
                'meetBeforeMin' => $this->meetBefore($request),
                'defaultNote'   => $request->optionalString('defaultNote'),
                'activeTo'      => $this->date($request, 'activeTo'),
            ],
            $request->string('scope'),
            $request->optionalSignedInt('fromEventId'),
        );

        return Response::ok($result);
    }

    public function deleteSeries(Request $request): Response
    {
        return Response::ok($this->events->deleteSeries(
            $request->identity(),
            $request->routeId('id'),
            $request->queryString('scope', 'all') ?? 'all',
            $request->queryInt('from'),
        ));
    }

    public function saveRsvp(Request $request): Response
    {
        return Response::ok($this->events->saveRsvp($request->identity(), $request->routeId('id'), [
            'rsvp'      => $request->string('rsvp'),
            'note'      => $request->optionalString('note'),
            'transport' => $request->string('transport', 'none'),
            'carSeats'  => $this->carSeats($request),
        ]));
    }

    public function saveAttendance(Request $request): Response
    {
        $items = [];

        foreach ($request->array('items') as $raw) {
            if (!is_array($raw)) {
                throw ApiException::validation('Každá oprava musí být objekt.', ['field' => 'items']);
            }

            $items[] = [
                'membershipId' => $this->membershipId($raw),
                // null = oprava se ruší a platí zase odvození z odpovědi hráče
                'attendance'   => is_string($raw['attendance'] ?? null) ? (string) $raw['attendance'] : null,
            ];
        }

        return Response::ok($this->events->saveAttendance($request->identity(), $request->routeId('id'), $items));
    }

    public function saveNominations(Request $request): Response
    {
        $items = [];

        foreach ($request->array('items') as $raw) {
            if (!is_array($raw) || !is_string($raw['nomination'] ?? null)) {
                throw ApiException::validation('Každá položka nominace musí mít stav.', ['field' => 'items']);
            }

            $items[] = [
                'membershipId' => $this->membershipId($raw),
                'nomination'   => (string) $raw['nomination'],
            ];
        }

        return Response::ok($this->events->saveNominations($request->identity(), $request->routeId('id'), $items));
    }

    public function summary(Request $request): Response
    {
        return Response::ok([
            'members' => $this->events->summary(
                $request->identity(),
                $request->routeId('season'),
                $request->queryString('type'),
            ),
        ]);
    }

    /** @param array<mixed> $raw */
    private function membershipId(array $raw): int
    {
        $value = $raw['membershipId'] ?? null;

        if (is_int($value) && $value > 0) {
            return $value;
        }

        if (is_string($value) && ctype_digit($value) && (int) $value > 0) {
            return (int) $value;
        }

        throw ApiException::validation('Chybí ID členství.', ['field' => 'membershipId']);
    }

    private function title(Request $request): string
    {
        $title = $request->string('title');

        if (mb_strlen($title) > 120) {
            throw ApiException::validation('Název je moc dlouhý (nejvýš 120 znaků).', ['field' => 'title']);
        }

        return $title;
    }

    /** Vzdálenost k soupeři: jednosměrná, podklad pro cesťák. */
    private function distance(Request $request): ?int
    {
        $value = $request->optionalSignedInt('distanceKm');

        if ($value !== null && ($value < 0 || $value > 2000)) {
            throw ApiException::validation('Vzdálenost musí být od 0 do 2000 km.', ['field' => 'distanceKm']);
        }

        return $value;
    }

    private function duration(Request $request): int
    {
        $value = array_key_exists('durationMin', $request->body) ? $request->int('durationMin') : 90;

        if ($value < 15 || $value > 720) {
            throw ApiException::validation('Délka akce musí být od 15 do 720 minut.', ['field' => 'durationMin']);
        }

        return $value;
    }

    private function meetBefore(Request $request): ?int
    {
        $value = $request->optionalSignedInt('meetBeforeMin');

        if ($value !== null && ($value < 0 || $value > 720)) {
            throw ApiException::validation('Sraz musí být nejvýš 12 hodin předem.', ['field' => 'meetBeforeMin']);
        }

        return $value;
    }

    private function carSeats(Request $request): ?int
    {
        $value = $request->optionalSignedInt('carSeats');

        if ($value !== null && ($value < 0 || $value > 8)) {
            throw ApiException::validation('Volných míst v autě může být nejvýš osm.', ['field' => 'carSeats']);
        }

        return $value;
    }

    /** Čas HH:MM; MySQL by jiný tvar uložila jako 00:00:00. */
    private function time(Request $request, string $key): string
    {
        $value = $request->string($key);

        if (preg_match('/^([01]\d|2[0-3]):[0-5]\d$/', $value) !== 1) {
            throw ApiException::validation("Pole $key musí být čas ve tvaru HH:MM.", ['field' => $key]);
        }

        return $value;
    }

    private function date(Request $request, string $key): string
    {
        return $this->assertDate($request->string($key), $key);
    }

    private function queryDate(Request $request, string $key): ?string
    {
        $value = $request->queryString($key);

        return $value === null ? null : $this->assertDate($value, $key);
    }

    private function assertDate(string $value, string $key): string
    {
        $date = DateTimeImmutable::createFromFormat('!Y-m-d', $value);

        if ($date === false || $date->format('Y-m-d') !== $value) {
            throw ApiException::validation("Pole $key musí být datum ve tvaru RRRR-MM-DD.", ['field' => $key]);
        }

        return $value;
    }

    private function dateTime(Request $request, string $key): string
    {
        return $this->normalizeDateTime($request->string($key), $key);
    }

    private function optionalDateTime(Request $request, string $key): ?string
    {
        $value = $request->optionalString($key);

        return $value === null ? null : $this->normalizeDateTime($value, $key);
    }

    /**
     * Přijímá „2026-09-15 18:00" i ISO tvar z `<input type="datetime-local">`
     * („2026-09-15T18:00"), případně i se sekundami. Ukládá se vždy s nulovými
     * sekundami — čas tréninku na vteřinu nikdo neřeší.
     */
    private function normalizeDateTime(string $value, string $key): string
    {
        $normalized = str_replace('T', ' ', $value);

        foreach (['!Y-m-d H:i:s', '!Y-m-d H:i'] as $format) {
            $parsed = DateTimeImmutable::createFromFormat($format, $normalized);

            if ($parsed !== false && $parsed->format(substr($format, 1)) === $normalized) {
                return $parsed->format('Y-m-d H:i:00');
            }
        }

        throw ApiException::validation(
            "Pole $key musí být datum a čas ve tvaru RRRR-MM-DD HH:MM.",
            ['field' => $key],
        );
    }
}
