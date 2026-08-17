<?php

declare(strict_types=1);

namespace Pina\Support;

use InvalidArgumentException;

/** Převod českého čísla účtu na IBAN, který vyžaduje formát SPAYD. */
final class CzechBankAccount
{
    public static function normalize(string $account): string
    {
        $compact = strtoupper((string) preg_replace('/\s+/', '', trim($account)));

        if (preg_match('/^CZ\d{22}$/', $compact) === 1) {
            if (self::mod97(substr($compact, 4) . '1235' . substr($compact, 2, 2)) !== 1) {
                throw new InvalidArgumentException('Neplatný kontrolní součet IBAN.');
            }

            return $compact;
        }

        if (preg_match('/^(?:(\d{1,6})-)?(\d{1,10})\/(\d{4})$/', $compact, $matches) !== 1) {
            throw new InvalidArgumentException('Číslo účtu musí být ve tvaru 123456789/0100 nebo český IBAN.');
        }

        $prefix = ltrim($matches[1], '0');
        $number = ltrim($matches[2], '0');

        return ($prefix === '' ? '' : $prefix . '-') . ($number === '' ? '0' : $number) . '/' . $matches[3];
    }

    public static function iban(string $account): string
    {
        $normalized = self::normalize($account);
        if (str_starts_with($normalized, 'CZ')) {
            return $normalized;
        }

        if (preg_match('/^(?:(\d{1,6})-)?(\d{1,10})\/(\d{4})$/', $normalized, $matches) !== 1) {
            throw new InvalidArgumentException('Číslo účtu nelze převést na IBAN.');
        }

        $bban       = $matches[3] . str_pad($matches[1], 6, '0', STR_PAD_LEFT)
                    . str_pad($matches[2], 10, '0', STR_PAD_LEFT);
        $check      = 98 - self::mod97($bban . '123500');

        return 'CZ' . str_pad((string) $check, 2, '0', STR_PAD_LEFT) . $bban;
    }

    private static function mod97(string $digits): int
    {
        $remainder = 0;
        foreach (str_split($digits) as $digit) {
            $remainder = ($remainder * 10 + (int) $digit) % 97;
        }

        return $remainder;
    }
}
