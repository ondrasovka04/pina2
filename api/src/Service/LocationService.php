<?php

declare(strict_types=1);

namespace Pina\Service;

use Pina\Auth\Identity;
use Pina\Auth\Role;
use Pina\Auth\TeamScope;
use Pina\Http\ApiException;
use Pina\Support\Database;

/**
 * Místa konání. Patří klubu, ne družstvu — halu na Proseku sdílejí junioři,
 * kadeti i muži, nikdo ji nechce zakládat třikrát. Souřadnice jsou volitelné,
 * zadávají se ručně a slouží k navigaci i pozdějšímu výpočtu vzdálenosti pro cesťáky.
 *
 * @phpstan-type LocationPayload array{
 *     id:int,
 *     clubId:int,
 *     name:string,
 *     address:string|null,
 *     lat:float|null,
 *     lng:float|null,
 *     note:string|null,
 *     usedByEvents:int
 * }
 */
final class LocationService
{
    public function __construct(
        private readonly Database $db,
        private readonly TeamScope $scope,
    ) {
    }

    /**
     * @return list<LocationPayload>
     */
    public function forClub(Identity $identity, int $clubId): array
    {
        $this->scope->club($identity, $clubId, Role::Player);

        $rows = $this->db->all(
            'SELECT l.*, (SELECT COUNT(*) FROM event e WHERE e.location_id = l.id) AS used_by_events
               FROM location l
              WHERE l.club_id = ?
              ORDER BY l.name',
            [$clubId],
        );

        return array_map($this->map(...), $rows);
    }

    /**
     * @param  array{name:string,address:string|null,lat:float|null,lng:float|null,note:string|null} $input
     * @return LocationPayload
     */
    public function create(Identity $identity, int $clubId, array $input): array
    {
        $this->scope->club($identity, $clubId, Role::Admin);

        $this->assertCoordinates($input['lat'], $input['lng']);

        $duplicate = $this->db->value(
            'SELECT id FROM location WHERE club_id = ? AND name = ?',
            [$clubId, $input['name']],
        );

        if ($duplicate !== null) {
            throw ApiException::conflict(
                'LOCATION_EXISTS',
                'Místo s tímto názvem už v klubu je.',
                ['field' => 'name'],
            );
        }

        $this->db->run(
            'INSERT INTO location (club_id, name, address, lat, lng, note) VALUES (?, ?, ?, ?, ?, ?)',
            [$clubId, $input['name'], $input['address'], $input['lat'], $input['lng'], $input['note']],
        );

        return $this->detail($this->db->lastInsertId());
    }

    /**
     * @param  array<string,mixed> $changes
     * @return LocationPayload
     */
    public function update(Identity $identity, int $locationId, array $changes): array
    {
        $current = $this->db->first('SELECT * FROM location WHERE id = ?', [$locationId]);

        if ($current === null) {
            throw ApiException::notFound();
        }

        $clubId = (int) $current['club_id'];
        $this->scope->club($identity, $clubId, Role::Admin);

        if ($changes === []) {
            throw ApiException::validation('Není co upravit — pošlete alespoň jedno pole.');
        }

        $name = array_key_exists('name', $changes) && is_string($changes['name'])
            ? $changes['name']
            : (string) $current['name'];
        $address = $this->pickNullableString($changes, 'address', $current['address']);
        $note    = $this->pickNullableString($changes, 'note', $current['note']);
        $lat     = $this->pickNullableFloat($changes, 'lat', $current['lat']);
        $lng     = $this->pickNullableFloat($changes, 'lng', $current['lng']);

        $this->assertCoordinates($lat, $lng);

        if ($name !== (string) $current['name']) {
            $duplicate = $this->db->value(
                'SELECT id FROM location WHERE club_id = ? AND name = ? AND id <> ?',
                [$clubId, $name, $locationId],
            );

            if ($duplicate !== null) {
                throw ApiException::conflict(
                    'LOCATION_EXISTS',
                    'Místo s tímto názvem už v klubu je.',
                    ['field' => 'name'],
                );
            }
        }

        $this->db->run(
            'UPDATE location SET name = ?, address = ?, lat = ?, lng = ?, note = ? WHERE id = ?',
            [$name, $address, $lat, $lng, $note, $locationId],
        );

        return $this->detail($locationId);
    }

    /** Místo použité u akce se nemaže — odkaz na halu je součást historie. */
    public function delete(Identity $identity, int $locationId): void
    {
        $clubId = $this->db->value('SELECT club_id FROM location WHERE id = ?', [$locationId]);

        if ($clubId === null) {
            throw ApiException::notFound();
        }

        $this->scope->club($identity, (int) $clubId, Role::Admin);

        $used = (int) $this->db->value(
            'SELECT COUNT(*) FROM event WHERE location_id = ?',
            [$locationId],
        );

        if ($used > 0) {
            throw ApiException::conflict(
                'LOCATION_IN_USE',
                'Místo je u nějaké akce, smazat nejde.',
                ['events' => $used],
            );
        }

        $this->db->run('DELETE FROM location WHERE id = ?', [$locationId]);
    }

    /**
     * @return LocationPayload
     */
    private function detail(int $locationId): array
    {
        $row = $this->db->first(
            'SELECT l.*, (SELECT COUNT(*) FROM event e WHERE e.location_id = l.id) AS used_by_events
               FROM location l WHERE l.id = ?',
            [$locationId],
        );

        if ($row === null) {
            throw ApiException::notFound();
        }

        return $this->map($row);
    }

    /**
     * @param  array<string,mixed> $row
     * @return LocationPayload
     */
    private function map(array $row): array
    {
        return [
            'id'           => (int) $row['id'],
            'clubId'       => (int) $row['club_id'],
            'name'         => (string) $row['name'],
            'address'      => $row['address'] === null ? null : (string) $row['address'],
            'lat'          => $row['lat'] === null ? null : (float) $row['lat'],
            'lng'          => $row['lng'] === null ? null : (float) $row['lng'],
            'note'         => $row['note'] === null ? null : (string) $row['note'],
            'usedByEvents' => (int) $row['used_by_events'],
        ];
    }

    /** Půlka souřadnice je horší než žádná — navigace by mířila do moře. */
    private function assertCoordinates(?float $lat, ?float $lng): void
    {
        if (($lat === null) !== ($lng === null)) {
            throw ApiException::validation(
                'Souřadnice se zadávají obě, nebo žádná.',
                ['field' => $lat === null ? 'lat' : 'lng'],
            );
        }

        if ($lat !== null && ($lat < -90 || $lat > 90)) {
            throw ApiException::validation('Zeměpisná šířka je mimo rozsah.', ['field' => 'lat']);
        }

        if ($lng !== null && ($lng < -180 || $lng > 180)) {
            throw ApiException::validation('Zeměpisná délka je mimo rozsah.', ['field' => 'lng']);
        }
    }

    /** @param array<string,mixed> $changes */
    private function pickNullableString(array $changes, string $key, mixed $fallback): ?string
    {
        if (!array_key_exists($key, $changes)) {
            return $fallback === null ? null : (string) $fallback;
        }

        return is_string($changes[$key]) ? $changes[$key] : null;
    }

    /** @param array<string,mixed> $changes */
    private function pickNullableFloat(array $changes, string $key, mixed $fallback): ?float
    {
        if (!array_key_exists($key, $changes)) {
            return $fallback === null ? null : (float) $fallback;
        }

        $value = $changes[$key];

        return is_float($value) || is_int($value) ? (float) $value : null;
    }
}
