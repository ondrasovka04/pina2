<?php

declare(strict_types=1);

namespace Pina\Controller;

use DateTimeImmutable;
use Pina\Http\ApiException;
use Pina\Http\Request;
use Pina\Http\Response;
use Pina\Service\OffenceService;

/** Tvar vstupu; pravidla a autorizace v OffenceService. */
final class OffenceController
{
    /** Limity: jeden požadavek ≠ desetitisíce řádků. */
    private const MAX_ITEMS       = 500;
    private const MAX_COUNT       = 99;
    private const MAX_TITLE       = 120;
    private const MAX_NOTE        = 255;
    private const DEFAULT_LIMIT   = 200;
    private const MAX_LIMIT       = 500;

    public function __construct(private readonly OffenceService $offences)
    {
    }

    public function index(Request $request): Response
    {
        $limit = $request->queryInt('limit') ?? self::DEFAULT_LIMIT;

        return Response::ok($this->offences->listRecords(
            $request->identity(),
            $request->routeId('season'),
            $request->queryInt('member'),
            self::optionalDate($request->queryString('from'), 'from'),
            self::optionalDate($request->queryString('to'), 'to'),
            in_array($request->queryString('includeVoided'), ['1', 'true'], true),
            max(1, min($limit, self::MAX_LIMIT)),
            max(0, $request->queryInt('offset') ?? 0),
        ));
    }

    /** Dávka (jádro app): idempotence přes clientUuid. */
    public function createBatch(Request $request): Response
    {
        $items = [];

        foreach ($request->array('items') as $index => $raw) {
            if (!is_array($raw)) {
                throw ApiException::validation('Položka musí být objekt.', ['field' => "items[$index]"]);
            }

            $count = array_key_exists('count', $raw) ? self::signedInt($raw, 'count', $index) : 1;

            if ($count < 1 || $count > self::MAX_COUNT) {
                throw ApiException::validation(
                    sprintf('Počet musí být mezi 1 a %d.', self::MAX_COUNT),
                    ['field' => "items[$index].count"],
                );
            }

            $items[] = [
                'membershipId'      => self::id($raw, 'membershipId', $index),
                'offenceTypeId'     => self::id($raw, 'offenceTypeId', $index),
                'count'             => $count,
                'note'              => self::optionalText($raw, 'note', self::MAX_NOTE, $index),
                'expectedAmountCzk' => array_key_exists('expectedAmountCzk', $raw)
                    ? self::signedInt($raw, 'expectedAmountCzk', $index)
                    : null,
            ];
        }

        if ($items === []) {
            throw ApiException::validation('Dávka musí obsahovat alespoň jednu položku.', ['field' => 'items']);
        }

        if (count($items) > self::MAX_ITEMS) {
            throw ApiException::validation(
                sprintf('Dávka smí mít nejvýš %d položek.', self::MAX_ITEMS),
                ['field' => 'items'],
            );
        }

        $summary = $this->offences->createBatch($request->identity(), $request->routeId('season'), [
            'clientUuid' => self::uuid($request->string('clientUuid')),
            'occurredOn' => self::date($request->string('occurredOn'), 'occurredOn'),
            'eventId'    => self::positiveOrNull($request->optionalSignedInt('eventId'), 'eventId'),
            'title'      => self::limit($request->optionalString('title'), self::MAX_TITLE, 'title'),
            'note'       => self::limit($request->optionalString('note'), self::MAX_NOTE, 'note'),
            'items'      => $items,
        ]);

        // 201 i pro opakované odeslání: klient dostane tentýž výsledek jako poprvé.
        return Response::created($summary);
    }

    public function batches(Request $request): Response
    {
        return Response::ok([
            'items' => $this->offences->batches($request->identity(), $request->routeId('season')),
        ]);
    }

    public function showBatch(Request $request): Response
    {
        return Response::ok($this->offences->showBatch($request->identity(), $request->routeId('id')));
    }

    public function voidBatch(Request $request): Response
    {
        return Response::ok($this->offences->voidBatch($request->identity(), $request->routeId('id')));
    }

    public function voidRecord(Request $request): Response
    {
        return Response::ok($this->offences->voidRecord($request->identity(), $request->routeId('id')));
    }

    public function balances(Request $request): Response
    {
        return Response::ok($this->offences->balances($request->identity(), $request->routeId('season')));
    }

    private static function uuid(string $value): string
    {
        $value = strtolower($value);

        if (preg_match('/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/', $value) !== 1) {
            throw ApiException::validation('Pole clientUuid musí být UUID.', ['field' => 'clientUuid']);
        }

        return $value;
    }

    private static function date(string $value, string $field): string
    {
        $date = DateTimeImmutable::createFromFormat('!Y-m-d', $value);

        if ($date === false || $date->format('Y-m-d') !== $value) {
            throw ApiException::validation("Pole $field musí být datum ve tvaru RRRR-MM-DD.", ['field' => $field]);
        }

        return $value;
    }

    private static function optionalDate(?string $value, string $field): ?string
    {
        return $value === null ? null : self::date($value, $field);
    }

    private static function positiveOrNull(?int $value, string $field): ?int
    {
        if ($value === null) {
            return null;
        }

        if ($value <= 0) {
            throw ApiException::validation("Pole $field musí být kladné číslo.", ['field' => $field]);
        }

        return $value;
    }

    private static function limit(?string $value, int $max, string $field): ?string
    {
        if ($value !== null && mb_strlen($value) > $max) {
            throw ApiException::validation(
                sprintf('Pole %s smí mít nejvýš %d znaků.', $field, $max),
                ['field' => $field],
            );
        }

        return $value;
    }

    /** @param array<mixed,mixed> $row */
    private static function optionalText(array $row, string $key, int $max, int $index): ?string
    {
        $value = $row[$key] ?? null;

        if (!is_string($value) || trim($value) === '') {
            return null;
        }

        return self::limit(trim($value), $max, "items[$index].$key");
    }

    /** @param array<mixed,mixed> $row */
    private static function id(array $row, string $key, int $index): int
    {
        $value = $row[$key] ?? null;

        if (is_int($value) && $value > 0) {
            return $value;
        }

        if (is_string($value) && ctype_digit($value) && (int) $value > 0) {
            return (int) $value;
        }

        throw ApiException::validation("Pole $key musí být kladné číslo.", ['field' => "items[$index].$key"]);
    }

    /** @param array<mixed,mixed> $row */
    private static function signedInt(array $row, string $key, int $index): int
    {
        $value = $row[$key] ?? null;

        if (is_int($value)) {
            return $value;
        }

        if (is_string($value) && preg_match('/^-?\d+$/', trim($value)) === 1) {
            return (int) trim($value);
        }

        throw ApiException::validation("Pole $key musí být celé číslo.", ['field' => "items[$index].$key"]);
    }
}
