<?php

declare(strict_types=1);

namespace Pina\Auth;

/**
 * Role v rámci jednoho týmu. Hierarchie: admin ⊃ treasurer ⊃ player.
 *
 * Admin tedy nepotřebuje druhou roli, aby si mohl zapsat vlastní prohřešek.
 */
enum Role: string
{
    case Player    = 'player';
    case Treasurer = 'treasurer';   // pínař
    case Admin     = 'admin';

    /** Vyšší číslo = víc oprávnění. */
    public function level(): int
    {
        return match ($this) {
            self::Player    => 1,
            self::Treasurer => 2,
            self::Admin     => 3,
        };
    }

    public function allows(self $required): bool
    {
        return $this->level() >= $required->level();
    }

    public function label(): string
    {
        return match ($this) {
            self::Player    => 'hráč',
            self::Treasurer => 'pínař',
            self::Admin     => 'admin',
        };
    }
}
