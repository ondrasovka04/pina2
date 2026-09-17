<?php

declare(strict_types=1);

namespace Pina\Service;

use Pina\Auth\Identity;
use Pina\Auth\Role;
use Pina\Http\ApiException;
use Pina\Support\Database;

/** Sdílené pravidlo viditelnosti dluhů a všech položek, ze kterých vznikají. */
final class FinancialAccess
{
    public function __construct(private readonly Database $db)
    {
    }

    /**
     * Vrátí ID vlastního členství, pokud hráč smí vidět jen sebe. Null znamená,
     * že pínař/admin nebo povolené nastavení smí vidět celé družstvo.
     */
    public function restrictedToMembership(Identity $identity, int $teamId): ?int
    {
        if ($identity->supportsTeam($teamId)) {
            return null;
        }

        $row = $this->db->first(
            'SELECT m.id, m.role, COALESCE(ts.balances_visible_to_players, 1) AS balances_visible
               FROM membership m
               LEFT JOIN team_settings ts ON ts.team_id = m.team_id
              WHERE m.team_id = ? AND m.user_id = ? AND m.status <> \'left\'',
            [$teamId, $identity->userId],
        );

        // Provozní správce bez členství nesmí přes běžné finanční obrazovky do cizího klubu.
        if ($row === null) {
            throw ApiException::notFound();
        }

        $role = Role::tryFrom((string) $row['role']);
        if ($role?->allows(Role::Treasurer) === true || (bool) $row['balances_visible']) {
            return null;
        }

        return (int) $row['id'];
    }
}
