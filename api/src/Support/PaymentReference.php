<?php

declare(strict_types=1);

namespace Pina\Support;

/**
 * Variabilní symbol členství.
 *
 * Musí být stabilní: hráč si ho jednou uloží do trvalého příkazu a už ho nikdy
 * nemění. Proto se počítá z ID týmu a uživatele, ne z pořadí nebo data.
 *
 * Tvar je 3 číslice týmu + 4 číslice uživatele + kontrolní číslice, dohromady 8 —
 * banky u VS připouštějí deset, takže je rezerva. Kontrolní číslice odchytí
 * překlep při ručním přepisu z papíru.
 *
 * Kolize jsou teoreticky možné (týmy 1 a 1001 mají stejné tři číslice), proto má
 * `membership.payment_reference` unikátní index — vložení kolidujícího VS selže
 * a nedojde k tichému spárování platby s cizím člověkem.
 */
final class PaymentReference
{
    public static function for(int $teamId, int $userId): string
    {
        $base = sprintf('%03d%04d', $teamId % 1000, $userId % 10000);
        $sum  = 0;

        foreach (str_split($base) as $i => $digit) {
            $sum += (int) $digit * (($i % 6) + 2);
        }

        return $base . ($sum % 11 % 10);
    }
}
