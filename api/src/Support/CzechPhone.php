<?php

declare(strict_types=1);

namespace Pina\Support;

use Pina\Http\ApiException;

final class CzechPhone
{
    public static function normalize(?string $phone): ?string
    {
        if ($phone === null) {
            return null;
        }

        $compact = preg_replace('/[\s\x{00a0}]+/u', '', $phone);
        if ($compact === '') {
            return null;
        }

        if ($compact === null || preg_match('/^(?:(?:\+|00)420)?([1-9][0-9]{8})$/D', $compact, $matches) !== 1) {
            throw ApiException::validation('Zadejte české číslo s 9 číslicemi, případně s předvolbou +420.', ['field' => 'phone']);
        }

        return '+420' . $matches[1];
    }
}
