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
        $exists = $this->db->value('SELECT 1 FROM team WHERE id = ?', [$teamId]);

        if ($exists === null) {
            throw ApiException::notFound();
        }

        $this->assert($identity, $teamId, $required);
    }

    /** Sezóna → tým. Vrací team_id, aby ho volající nemusel dohledávat. */
    public function season(Identity $identity, int $seasonId, Role $required): int
    {
        $teamId = $this->db->value('SELECT team_id FROM season WHERE id = ?', [$seasonId]);

        if ($teamId === null) {
            throw ApiException::notFound();
        }

        $this->assert($identity, (int) $teamId, $required);

        return (int) $teamId;
    }

    /**
     * Sezóna, do které se bude zapisovat. Navíc kontroluje, že není uzavřená —
     * do skončené sezóny nemá smysl doplňovat prohřešky.
     */
    public function writableSeason(Identity $identity, int $seasonId, Role $required): int
    {
        $row = $this->db->first('SELECT team_id, closed_at FROM season WHERE id = ?', [$seasonId]);

        if ($row === null) {
            throw ApiException::notFound();
        }

        $this->assert($identity, (int) $row['team_id'], $required);

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
        $teamId = $this->db->value('SELECT team_id FROM membership WHERE id = ?', [$membershipId]);

        if ($teamId === null) {
            throw ApiException::notFound();
        }

        $this->assert($identity, (int) $teamId, $required);

        return (int) $teamId;
    }

    /** Akce → sezóna → tým. */
    public function event(Identity $identity, int $eventId, Role $required): int
    {
        $teamId = $this->db->value(
            'SELECT s.team_id FROM event e JOIN season s ON s.id = e.season_id WHERE e.id = ?',
            [$eventId],
        );

        if ($teamId === null) {
            throw ApiException::notFound();
        }

        $this->assert($identity, (int) $teamId, $required);

        return (int) $teamId;
    }

    /** Klub. Používá se u nastavení a míst, která jsou sdílená mezi družstvy. */
    public function club(Identity $identity, int $clubId, Role $required): void
    {
        if ($identity->isPlatformAdmin) {
            return;
        }

        $teamIds = $identity->teamIds();
        if ($teamIds === []) {
            throw ApiException::notFound();
        }

        $placeholders = implode(',', array_fill(0, count($teamIds), '?'));
        $rows = $this->db->all(
            "SELECT id FROM team WHERE club_id = ? AND id IN ($placeholders)",
            [$clubId, ...$teamIds],
        );

        foreach ($rows as $row) {
            if ($identity->hasRoleInTeam((int) $row['id'], $required)) {
                return;
            }
        }

        throw ApiException::notFound();
    }

    /**
     * Hráč smí měnit jen vlastní záznamy (RSVP, „jedu autem"). Pínař a admin
     * mohou zasahovat i ostatním.
     */
    public function ownMembershipOr(Identity $identity, int $membershipId, Role $required): int
    {
        $row = $this->db->first(
            'SELECT team_id, user_id FROM membership WHERE id = ?',
            [$membershipId],
        );

        if ($row === null) {
            throw ApiException::notFound();
        }

        $teamId = (int) $row['team_id'];

        if ((int) $row['user_id'] === $identity->userId && $identity->isMemberOf($teamId)) {
            return $teamId;
        }

        $this->assert($identity, $teamId, $required);

        return $teamId;
    }

    private function assert(Identity $identity, int $teamId, Role $required): void
    {
        if ($identity->isPlatformAdmin) {
            return;
        }

        // Členství se ověřuje proti databázi, ne proti tokenu: role mohla být
        // odebrána po vydání tokenu a ten platí ještě 15 minut.
        $role = $this->db->value(
            "SELECT role FROM membership WHERE user_id = ? AND team_id = ? AND status <> 'left'",
            [$identity->userId, $teamId],
        );

        if ($role === null) {
            throw ApiException::notFound();
        }

        $actual = Role::tryFrom((string) $role);

        if (!$actual instanceof Role || !$actual->allows($required)) {
            throw ApiException::forbidden(
                sprintf('K této akci je potřeba role %s.', $required->label()),
            );
        }
    }
}
