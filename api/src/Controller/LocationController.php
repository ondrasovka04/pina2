<?php

declare(strict_types=1);

namespace Pina\Controller;

use Pina\Http\ApiException;
use Pina\Http\Request;
use Pina\Http\Response;
use Pina\Service\LocationService;

/** Místa konání — patří klubu, sdílejí je všechna jeho družstva. */
final class LocationController
{
    public function __construct(private readonly LocationService $locations)
    {
    }

    public function index(Request $request): Response
    {
        return Response::ok([
            'locations' => $this->locations->forClub($request->identity(), $request->routeId('club')),
        ]);
    }

    public function store(Request $request): Response
    {
        $location = $this->locations->create($request->identity(), $request->routeId('club'), [
            'name'    => $request->string('name'),
            'address' => $request->optionalString('address'),
            'lat'     => $this->coordinate($request, 'lat'),
            'lng'     => $this->coordinate($request, 'lng'),
            'note'    => $request->optionalString('note'),
        ]);

        return Response::created($location);
    }

    public function update(Request $request): Response
    {
        $changes = [];

        foreach (['name', 'address', 'note'] as $key) {
            if (array_key_exists($key, $request->body)) {
                $changes[$key] = $request->optionalString($key);
            }
        }

        foreach (['lat', 'lng'] as $key) {
            if (array_key_exists($key, $request->body)) {
                $changes[$key] = $this->coordinate($request, $key);
            }
        }

        return Response::ok($this->locations->update($request->identity(), $request->routeId('id'), $changes));
    }

    public function delete(Request $request): Response
    {
        $this->locations->delete($request->identity(), $request->routeId('id'));

        return Response::noContent();
    }

    private function coordinate(Request $request, string $key): ?float
    {
        $value = $request->body[$key] ?? null;

        if ($value === null || $value === '') {
            return null;
        }

        if (is_float($value) || is_int($value)) {
            return (float) $value;
        }

        if (is_string($value) && is_numeric($value)) {
            return (float) $value;
        }

        throw ApiException::validation("Pole $key musí být desetinné číslo.", ['field' => $key]);
    }
}
