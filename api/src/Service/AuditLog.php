<?php

declare(strict_types=1);

namespace Pina\Service;

use JsonException;
use Pina\Auth\Identity;
use Pina\Auth\Role;
use Pina\Auth\TeamScope;
use Pina\Http\ApiException;
use Pina\Support\Database;

/**
 * Provozní stopa citlivých změn. Zápis volá doménová služba uvnitř stejné
 * transakce jako samotnou změnu; tato třída transakci záměrně neotvírá.
 *
 * @phpstan-type AuditEntry array{
 *     id:int,
 *     action:string,
 *     entity:string,
 *     entityId:int|null,
 *     payload:array<string,mixed>,
 *     createdAt:string,
 *     actor:array{id:int,name:string}|null,
 *     membershipName:string|null,
 *     offenceTypeName:string|null,
 *     eventTitle:string|null,
 *     seasonName:string|null
 * }
 * @phpstan-type AuditPage array{
 *     items:list<AuditEntry>,
 *     pagination:array{limit:int,offset:int,total:int,hasMore:bool}
 * }
 */
final class AuditLog
{
    public function __construct(
        private readonly Database $db,
        private readonly TeamScope $scope,
    ) {
    }

    /** @param array<string,mixed> $payload */
    public function record(
        Identity $actor,
        ?int $teamId,
        string $action,
        string $entity,
        ?int $entityId,
        array $payload = [],
    ): int {
        try {
            $encoded = $payload === [] ? null : json_encode($payload, JSON_THROW_ON_ERROR);
        } catch (JsonException $e) {
            throw new \LogicException('Payload provozní stopy nelze převést na JSON.', previous: $e);
        }

        $this->db->run(
            'INSERT INTO audit_log (team_id, actor_user_id, action, entity, entity_id, payload)
             VALUES (?, ?, ?, ?, ?, ?)',
            [$teamId, $actor->userId, $action, $entity, $entityId, $encoded],
        );

        return $this->db->lastInsertId();
    }

    /** @return AuditPage */
    public function forTeam(Identity $identity, int $teamId, int $limit, int $offset): array
    {
        $this->scope->team($identity, $teamId, Role::Admin);

        // Platformní role nesmí obejít členství v konkrétním družstvu. Cizí
        // družstvo se tváří jako neexistující, nižší role v jeho vlastním týmu
        // dostane obvyklý zákaz.
        $role = $this->db->value(
            "SELECT role FROM membership WHERE team_id = ? AND user_id = ? AND status <> 'left'",
            [$teamId, $identity->userId],
        );

        if ($role === null) {
            throw ApiException::notFound();
        }

        if ($role !== Role::Admin->value) {
            throw ApiException::forbidden('Provozní stopu vidí jen admin družstva.');
        }

        $rows = $this->db->all(
            'SELECT a.id, a.action, a.entity, a.entity_id, a.payload, a.created_at,
                    u.id AS actor_id, u.display_name AS actor_name
               FROM audit_log a
               LEFT JOIN `user` u ON u.id = a.actor_user_id
              WHERE a.team_id = ?
              ORDER BY a.created_at DESC, a.id DESC
              LIMIT ? OFFSET ?',
            [$teamId, $limit, $offset],
        );

        $decoded = array_map($this->decodeRow(...), $rows);
        $names   = $this->referenceNames($teamId, $decoded);
        $items   = [];

        foreach ($decoded as $row) {
            $membershipId = $this->referenceId($row, 'membershipId', 'membership');
            $typeId       = $this->referenceId($row, 'offenceTypeId', 'offence_type');
            $eventId      = $this->referenceId($row, 'eventId', 'event');
            $seasonId     = $this->referenceId($row, 'seasonId', 'season');

            $items[] = [
                'id'              => $row['id'],
                'action'          => $row['action'],
                'entity'          => $row['entity'],
                'entityId'        => $row['entityId'],
                'payload'         => $row['payload'],
                'createdAt'       => $row['createdAt'],
                'actor'           => $row['actor'],
                'membershipName'  => $membershipId === null ? null : ($names['memberships'][$membershipId] ?? null),
                'offenceTypeName' => $typeId === null ? null : ($names['offenceTypes'][$typeId] ?? null),
                'eventTitle'      => $eventId === null ? null : ($names['events'][$eventId] ?? null),
                'seasonName'      => $seasonId === null ? null : ($names['seasons'][$seasonId] ?? null),
            ];
        }

        $total = (int) $this->db->value('SELECT COUNT(*) FROM audit_log WHERE team_id = ?', [$teamId]);

        return [
            'items'      => $items,
            'pagination' => [
                'limit'   => $limit,
                'offset'  => $offset,
                'total'   => $total,
                'hasMore' => $offset + count($items) < $total,
            ],
        ];
    }

    /**
     * @param  array<string,mixed> $row
     * @return array{
     *     id:int,action:string,entity:string,entityId:int|null,payload:array<string,mixed>,
     *     createdAt:string,actor:array{id:int,name:string}|null
     * }
     */
    private function decodeRow(array $row): array
    {
        $payload = [];

        if (is_string($row['payload'] ?? null)) {
            try {
                $value   = json_decode($row['payload'], true, flags: JSON_THROW_ON_ERROR);
                $payload = is_array($value) ? $value : [];
            } catch (JsonException) {
                $payload = [];
            }
        }

        return [
            'id'        => (int) $row['id'],
            'action'    => (string) $row['action'],
            'entity'    => (string) $row['entity'],
            'entityId'  => $row['entity_id'] === null ? null : (int) $row['entity_id'],
            'payload'   => $payload,
            'createdAt' => (string) $row['created_at'],
            'actor'     => $row['actor_id'] === null ? null : [
                'id'   => (int) $row['actor_id'],
                'name' => (string) $row['actor_name'],
            ],
        ];
    }

    /**
     * @param list<array{
     *     id:int,action:string,entity:string,entityId:int|null,payload:array<string,mixed>,
     *     createdAt:string,actor:array{id:int,name:string}|null
     * }> $rows
     * @return array{
     *     memberships:array<int,string>,offenceTypes:array<int,string>,
     *     events:array<int,string>,seasons:array<int,string>
     * }
     */
    private function referenceNames(int $teamId, array $rows): array
    {
        $ids = ['memberships' => [], 'offenceTypes' => [], 'events' => [], 'seasons' => []];

        foreach ($rows as $row) {
            foreach ([
                ['memberships', 'membershipId', 'membership'],
                ['offenceTypes', 'offenceTypeId', 'offence_type'],
                ['events', 'eventId', 'event'],
                ['seasons', 'seasonId', 'season'],
            ] as [$bucket, $payloadKey, $entity]) {
                $id = $this->referenceId($row, $payloadKey, $entity);
                if ($id !== null) {
                    $ids[$bucket][$id] = true;
                }
            }
        }

        return [
            'memberships' => $this->loadNames(
                'SELECT m.id, u.display_name AS name FROM membership m JOIN `user` u ON u.id = m.user_id WHERE m.team_id = ? AND m.id IN (%s)',
                $teamId,
                array_keys($ids['memberships']),
            ),
            'offenceTypes' => $this->loadNames(
                'SELECT ot.id, ot.name FROM offence_type ot JOIN season s ON s.id = ot.season_id WHERE s.team_id = ? AND ot.id IN (%s)',
                $teamId,
                array_keys($ids['offenceTypes']),
            ),
            'events' => $this->loadNames(
                'SELECT e.id, e.title AS name FROM event e JOIN season s ON s.id = e.season_id WHERE s.team_id = ? AND e.id IN (%s)',
                $teamId,
                array_keys($ids['events']),
            ),
            'seasons' => $this->loadNames(
                'SELECT s.id, s.name FROM season s WHERE s.team_id = ? AND s.id IN (%s)',
                $teamId,
                array_keys($ids['seasons']),
            ),
        ];
    }

    /**
     * @param  list<int>         $ids
     * @return array<int,string>
     */
    private function loadNames(string $sql, int $teamId, array $ids): array
    {
        if ($ids === []) {
            return [];
        }

        $placeholders = implode(',', array_fill(0, count($ids), '?'));
        $rows         = $this->db->all(sprintf($sql, $placeholders), [$teamId, ...$ids]);
        $names        = [];

        foreach ($rows as $row) {
            $names[(int) $row['id']] = (string) $row['name'];
        }

        return $names;
    }

    /**
     * @param array{
     *     id:int,action:string,entity:string,entityId:int|null,payload:array<string,mixed>,
     *     createdAt:string,actor:array{id:int,name:string}|null
     * } $row
     */
    private function referenceId(array $row, string $payloadKey, string $entity): ?int
    {
        $value = $row['payload'][$payloadKey] ?? null;

        if (is_int($value) && $value > 0) {
            return $value;
        }

        return $row['entity'] === $entity ? $row['entityId'] : null;
    }
}
