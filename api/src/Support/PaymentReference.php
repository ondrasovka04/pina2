<?php

declare(strict_types=1);

namespace Pina\Support;

/**
 * Variabilní symbol: stabilní (z ID týmu+uživatele, ne data).
 * 8 cifer: 3×tým, 4×uživatel, 1×kontrola. Kolize chytá DB unikátní index.
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
