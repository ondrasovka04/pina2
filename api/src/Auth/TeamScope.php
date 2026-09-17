<?php

declare(strict_types=1);

namespace Pina\Auth;

use Pina\Http\ApiException;
use Pina\Support\Database;

/**
 * Autorizace na úroveň záznamu: role z DB (ne tokenu), 404 na cizí i neexistující.
 * Hlavní obrana proti IDOR útokům (změna ID v URL).
 */
final class TeamScope
{
    public function __construct(private readonly Database $db)
    {
    }

    /** Tým samotný. */
    public function team(Identity $identity, int $teamId, Role $required): void
    {
        $this->resolve($identity, 'team', 'SELECT t.id AS team_id FROM team t WHERE t.id = ?', $teamId, $required);
    }

    /** Sezóna → tým (vrací team_id). */
    public function season(Identity $identity, int $seasonId, Role $required): int
    {
        $row = $this->resolve(
            $identity,
            'season',
            'SELECT s.team_id, s.closed_at FROM season s WHERE s.id = ?',
            $seasonId,
            $required,
        );

        return (int) $row['team_id'];
    }

    /** Sezóna pro zápis: musí být otevřená. */
    public function writableSeason(Identity $identity, int $seasonId, Role $required): int
    {
        $row = $this->resolve(
            $identity,
            'season',
            'SELECT s.team_id, s.closed_at FROM season s WHERE s.id = ?',
            $seasonId,
            $required,
        );

        if ($row['closed_at'] !== null) {
            throw ApiException::conflict(
                'SEASON_CLOSED',
                'Sezóna je uzavřená, zápis nelze provést.',
                ['seasonId' => $seasonId],
            );
        }

        return (int) $row['team_id'];
    }

    /** Členství → tým (vrací team_id). */
    public function membership(Identity $identity, int $membershipId, Role $required): int
    {
        $row = $this->resolve(
            $identity,
            'membership',
            'SELECT m.team_id, m.user_id AS owner_id FROM membership m WHERE m.id = ?',
            $membershipId,
            $required,
        );

        return (int) $row['team_id'];
    }

    /** Pozvánka → tým (vrací team_id). */
    public function invitation(Identity $identity, int $invitationId, Role $required): int
    {
        $row = $this->resolve(
            $identity,
            'invitation',
            'SELECT i.team_id FROM invitation i WHERE i.id = ?',
            $invitationId,
            $required,
        );

        return (int) $row['team_id'];
    }

    /** Akce → sezóna → tým (vrací team_id). */
    public function event(Identity $identity, int $eventId, Role $required): int
    {
        $row = $this->resolve(
            $identity,
            'event',
            'SELECT s.team_id FROM event e JOIN season s ON s.id = e.season_id WHERE e.id = ?',
            $eventId,
            $required,
        );

        return (int) $row['team_id'];
    }

    /** Hráč jen svůj záznam; pínař a admin i ostatní. */
    public function ownMembershipOr(Identity $identity, int $membershipId, Role $required): int
    {
        $row = $this->db->first(
            'SELECT m.team_id, m.user_id AS owner_id, mine.role AS my_role
               FROM membership m
               LEFT JOIN membership mine
                      ON mine.team_id = m.team_id
                     AND mine.user_id = ?
                     AND mine.status <> \'left\'
              WHERE m.id = ?',
            [$identity->userId, $membershipId],
        );

        if ($row === null) {
            throw ApiException::notFound();
        }

        $teamId = (int) $row['team_id'];

        $this->assertSupportTeam($identity, $teamId);

        if ($identity->supportsTeam($teamId)) {
            return $teamId;
        }

        if ($row['my_role'] === null) {
            throw ApiException::notFound();
        }

        // Vlastní záznam si hráč upraví bez ohledu na roli.
        if ((int) $row['owner_id'] === $identity->userId) {
            return $teamId;
        }

        $this->requireRole($row['my_role'], $required);

        return $teamId;
    }

    /** Klub: sdílená nastavení mezi družstvy. */
    public function club(Identity $identity, int $clubId, Role $required): void
    {
        if ($identity->supportTeamId !== null) {
            $supportClub = $this->db->value('SELECT club_id FROM team WHERE id = ?', [$identity->supportTeamId]);
            if (!$identity->isPlatformAdmin || $supportClub === null || (int) $supportClub !== $clubId) {
                throw ApiException::notFound();
            }
            return;
        }

        $roles = $this->db->all(
            'SELECT m.role
               FROM membership m
               JOIN team t ON t.id = m.team_id
              WHERE t.club_id = ? AND m.user_id = ? AND m.status <> \'left\'',
            [$clubId, $identity->userId],
        );

        foreach ($roles as $row) {
            $role = Role::tryFrom((string) $row['role']);
            if ($role instanceof Role && $role->allows($required)) {
                return;
            }
        }

        throw ApiException::notFound();
    }

    /**
     * Zjistí vlastníka a roli volajícího v jednom dotazu.
     * POZOR: $sql jen literál z téže třídy, nikdy z požadavku (SQL injection prevence).
     *
     * @param  string              $alias  popis entity pro čitelnost
     * @param  string              $sql    literál; musí vracet team_id a jeden parametr
     * @return array<string,mixed>
     */
    private function resolve(Identity $identity, string $alias, string $sql, int $id, Role $required): array
    {
        $row = $this->db->first(
            "SELECT base.*, m.role AS my_role
               FROM ($sql) AS base
               LEFT JOIN membership m
                      ON m.team_id = base.team_id
                     AND m.user_id = ?
                     AND m.status <> 'left'",
            [$id, $identity->userId],
        );

        if ($row === null) {
            throw ApiException::notFound();
        }

        $this->assertSupportTeam($identity, (int) $row['team_id']);

        if ($identity->supportsTeam((int) $row['team_id'])) {
            return $row;
        }

        // Volající není v týmu — vrátit 404 (nerozlišuj od neexistujícího).
        if ($row['my_role'] === null) {
            throw ApiException::notFound();
        }

        $this->requireRole($row['my_role'], $required);

        return $row;
    }

    private function assertSupportTeam(Identity $identity, int $teamId): void
    {
        if ($identity->supportTeamId !== null && !$identity->supportsTeam($teamId)) {
            throw ApiException::notFound();
        }
    }

    private function requireRole(mixed $actualRole, Role $required): void
    {
        $role = Role::tryFrom((string) $actualRole);

        if (!$role instanceof Role || !$role->allows($required)) {
            throw ApiException::forbidden(
                sprintf('K této akci je potřeba role %s.', $required->label()),
            );
        }
    }
}
