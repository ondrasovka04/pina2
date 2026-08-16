<?php

declare(strict_types=1);

namespace Pina\Controller;

use Pina\Http\ApiException;
use Pina\Http\Request;
use Pina\Http\Response;
use Pina\Service\OffenceTypeService;

/** Sazebník: tvar vstupu; logika a autorizace v OffenceTypeService. */
final class OffenceTypeController
{
    private const MAX_NAME = 120;

    public function __construct(private readonly OffenceTypeService $types)
    {
    }

    public function index(Request $request): Response
    {
        $includeArchived = in_array($request->queryString('includeArchived'), ['1', 'true'], true);

        return Response::ok([
            'items' => $this->types->listForSeason(
                $request->identity(),
                $request->routeId('season'),
                $includeArchived,
            ),
        ]);
    }

    public function store(Request $request): Response
    {
        $type = $this->types->create($request->identity(), $request->routeId('season'), [
            'name'      => $this->name($request->string('name')),
            'amountCzk' => $request->signedInt('amountCzk'),
            'sortOrder' => $request->optionalSignedInt('sortOrder') ?? 0,
            'category'  => self::enum($request->optionalString('category'), OffenceTypeService::CATEGORIES, 'category'),
            'autoRule'  => self::enum($request->optionalString('autoRule'), OffenceTypeService::AUTO_RULES, 'autoRule') ?? 'none',
            'autoEventType' => self::enum(
                $request->optionalString('autoEventType'),
                OffenceTypeService::AUTO_EVENT_TYPES,
                'autoEventType',
            ) ?? 'any',
        ]);

        return Response::created($type);
    }

    public function update(Request $request): Response
    {
        /**
         * @var array{
         *     name?:string,amountCzk?:int,sortOrder?:int,category?:string|null,
         *     autoRule?:string,autoEventType?:string,archived?:bool
         * } $changes
         */
        $changes = [];

        if (array_key_exists('name', $request->body)) {
            $changes['name'] = $this->name($request->string('name'));
        }

        if (array_key_exists('amountCzk', $request->body)) {
            $changes['amountCzk'] = $request->signedInt('amountCzk');
        }

        if (array_key_exists('sortOrder', $request->body)) {
            $changes['sortOrder'] = $request->signedInt('sortOrder');
        }

        if (array_key_exists('category', $request->body)) {
            $changes['category'] = self::enum(
                $request->optionalString('category'),
                OffenceTypeService::CATEGORIES,
                'category',
            );
        }

        if (array_key_exists('autoRule', $request->body)) {
            $changes['autoRule'] = self::enum(
                $request->optionalString('autoRule'),
                OffenceTypeService::AUTO_RULES,
                'autoRule',
            ) ?? 'none';
        }

        if (array_key_exists('autoEventType', $request->body)) {
            $changes['autoEventType'] = self::enum(
                $request->optionalString('autoEventType'),
                OffenceTypeService::AUTO_EVENT_TYPES,
                'autoEventType',
            ) ?? 'any';
        }

        if (array_key_exists('archived', $request->body)) {
            $changes['archived'] = $request->bool('archived');
        }

        return Response::ok($this->types->update($request->identity(), $request->routeId('id'), $changes));
    }

    /** Nové pořadí: celý seznam ID (ne jednotlivé posuny). */
    public function reorder(Request $request): Response
    {
        $ids = [];

        foreach ($request->array('offenceTypeIds') as $index => $value) {
            $ids[] = self::id(['id' => $value], 'id', $index);
        }

        return Response::ok([
            'items' => $this->types->reorder($request->identity(), $request->routeId('season'), $ids),
        ]);
    }

    /** DELETE tu znamená archivaci — na položce visí zapsaná historie. */
    public function archive(Request $request): Response
    {
        return Response::ok($this->types->archive($request->identity(), $request->routeId('id')));
    }

    /**
     * Převzetí sazebníku z jiné sezóny. Bez těla se kopíruje celý,
     * s `items` jen vybrané položky a volitelně za jinou cenu.
     */
    public function copyFrom(Request $request): Response
    {
        /** @var list<int> $onlyTypeIds */
        $onlyTypeIds = [];
        /** @var array<int,int> $amountOverrides */
        $amountOverrides = [];

        if (array_key_exists('items', $request->body)) {
            foreach ($request->array('items') as $index => $raw) {
                if (!is_array($raw)) {
                    throw ApiException::validation('Položka musí být objekt.', ['field' => "items[$index]"]);
                }

                $typeId        = self::id($raw, 'offenceTypeId', $index);
                $onlyTypeIds[] = $typeId;

                if (array_key_exists('amountCzk', $raw)) {
                    $amountOverrides[$typeId] = self::signedInt($raw, 'amountCzk', $index);
                }
            }

            if ($onlyTypeIds === []) {
                throw ApiException::validation('Vyberte alespoň jednu položku.', ['field' => 'items']);
            }
        }

        $result = $this->types->copyFrom(
            $request->identity(),
            $request->routeId('season'),
            $request->routeId('source'),
            $onlyTypeIds,
            $amountOverrides,
        );

        return Response::created([
            'created'      => $result['created'],
            'createdCount' => count($result['created']),
            'skipped'      => $result['skipped'],
        ]);
    }

    private function name(string $value): string
    {
        if (mb_strlen($value) > self::MAX_NAME) {
            throw ApiException::validation(
                sprintf('Název smí mít nejvýš %d znaků.', self::MAX_NAME),
                ['field' => 'name'],
            );
        }

        return $value;
    }

    /** @param list<string> $allowed */
    private static function enum(?string $value, array $allowed, string $field): ?string
    {
        if ($value === null) {
            return null;
        }

        if (!in_array($value, $allowed, true)) {
            throw ApiException::validation(
                "Pole $field má neplatnou hodnotu.",
                ['field' => $field, 'allowed' => $allowed],
            );
        }

        return $value;
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
