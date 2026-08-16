<?php

declare(strict_types=1);

namespace Pina\Controller;

use DateTimeImmutable;
use Pina\Http\ApiException;
use Pina\Http\Request;
use Pina\Http\Response;
use Pina\Service\SeasonService;

/**
 * Sezóny a soupisky.
 */
final class SeasonController
{
    public function __construct(private readonly SeasonService $seasons)
    {
    }

    public function index(Request $request): Response
    {
        return Response::ok([
            'seasons' => $this->seasons->forTeam($request->identity(), $request->routeId('team')),
        ]);
    }

    public function create(Request $request): Response
    {
        $season = $this->seasons->create(
            $request->identity(),
            $request->routeId('team'),
            $request->string('name'),
            $this->date($request, 'startsOn'),
            $this->date($request, 'endsOn'),
        );

        return Response::created($season);
    }

    public function update(Request $request): Response
    {
        /** @var array{name?:string,startsOn?:string,endsOn?:string} $changes */
        $changes = [];

        if (array_key_exists('name', $request->body)) {
            $changes['name'] = $request->string('name');
        }

        if (array_key_exists('startsOn', $request->body)) {
            $changes['startsOn'] = $this->date($request, 'startsOn');
        }

        if (array_key_exists('endsOn', $request->body)) {
            $changes['endsOn'] = $this->date($request, 'endsOn');
        }

        return Response::ok($this->seasons->update($request->identity(), $request->routeId('id'), $changes));
    }

    public function close(Request $request): Response
    {
        return Response::ok($this->seasons->close($request->identity(), $request->routeId('id')));
    }

    public function roster(Request $request): Response
    {
        return Response::ok([
            'roster' => $this->seasons->roster($request->identity(), $request->routeId('id')),
        ]);
    }

    public function saveRoster(Request $request): Response
    {
        $ids = [];

        foreach ($request->array('membershipIds') as $value) {
            if (is_int($value) && $value > 0) {
                $ids[] = $value;

                continue;
            }

            if (is_string($value) && ctype_digit($value) && (int) $value > 0) {
                $ids[] = (int) $value;

                continue;
            }

            throw ApiException::validation(
                'Soupiska musí obsahovat jen ID členství.',
                ['field' => 'membershipIds'],
            );
        }

        return Response::ok([
            'roster' => $this->seasons->setRoster($request->identity(), $request->routeId('id'), $ids),
        ]);
    }

    /** Datum se posílá jako RRRR-MM-DD; jiný tvar by MySQL tiše uložila jako 0000-00-00. */
    private function date(Request $request, string $key): string
    {
        $value = $request->string($key);
        $date  = DateTimeImmutable::createFromFormat('!Y-m-d', $value);

        if ($date === false || $date->format('Y-m-d') !== $value) {
            throw ApiException::validation("Pole $key musí být datum ve tvaru RRRR-MM-DD.", ['field' => $key]);
        }

        return $value;
    }
}
