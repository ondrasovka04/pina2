<?php

declare(strict_types=1);

namespace Pina\Auth;

use Pina\Http\ApiException;
use Pina\Support\Database;

/**
 * Ověřuje, že volající smí sáhnout na konkrétní záznam, a zároveň že ten záznam
 * patří jeho týmu.
 *
 * Tohle je hlavní obrana proti IDOR — útoku, kdy útočník změní ID v URL a dostane
 * se k cizím datům. Stará verze proti tomu neměla vůbec nic: role existovaly jen
 * v UI a API vůbec neřešilo, kdo volá.
 *
 * Role se čte z databáze, ne z tokenu. Nestojí to nic navíc: aby se zjistilo,
 * komu daný záznam patří, se do databáze sáhnout musí tak jako tak, takže se
 * členství připojí do téhož dotazu.
 *
 * Zásada: když záznam neexistuje NEBO nepatří volajícímu, vrací se shodně 404.
 * Rozdíl mezi 403 a 404 by prozrazoval, která cizí ID existují.
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

    /** Sezóna → tým. Vrací team_id, aby ho volající nemusel dohledávat. */
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

    /**
     * Sezóna, do které se bude zapisovat. Navíc kontroluje, že není uzavřená —
     * do skončené sezóny nemá smysl doplňovat prohřešky.
     */
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

    /** Členství → tým. */
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

    /** Pozvánka → tým. */
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

    /** Akce → sezóna → tým. */
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

    /**
     * Hráč smí měnit jen vlastní záznamy (RSVP, „jedu autem"). Pínař a admin
     * mohou zasahovat i ostatním.
     */
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

        if ($identity->isPlatformAdmin) {
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

    /** Klub. Používá se u nastavení a míst, která jsou sdílená mezi družstvy. */
    public function club(Identity $identity, int $clubId, Role $required): void
    {
        if ($identity->isPlatformAdmin) {
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
     * Jedním dotazem zjistí vlastníka záznamu i roli volajícího v jeho týmu.
     *
     * POZOR: $sql se vkládá do výsledného dotazu textově, protože parametrizovat
     * lze jen hodnoty, nikoli části příkazu. Smí sem proto přijít **výhradně
     * literál napsaný v této třídě** — nikdy nic, co pochází z požadavku.
     * Hodnoty ($id, userId) jdou standardně jako parametry.
     *
     * @param  string              $alias  popis entity pro čitelnost volání
     * @param  string              $sql    literál; musí vracet sloupec team_id a mít jeden parametr (id)
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

        if ($identity->isPlatformAdmin) {
            return $row;
        }

        // Volající v týmu vůbec není — záznam se tváří jako neexistující.
        if ($row['my_role'] === null) {
            throw ApiException::notFound();
        }

        $this->requireRole($row['my_role'], $required);

        return $row;
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
