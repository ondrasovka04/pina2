<?php

declare(strict_types=1);

namespace Pina\Auth;

use Pina\Http\ApiException;

/**
 * Práce s hesly. Stará verze používala SHA-256 bez soli, což je proti
 * slovníkovému útoku prakticky bezcenné — staré hashe se proto nepřenášejí
 * a všichni si nastavují heslo znovu.
 */
final class PasswordService
{
    private const MIN_LENGTH = 10;

    /**
     * Nejčastější hesla, která projdou i přísnými pravidly na složitost.
     * Krátký seznam stačí — chytá to typické volby, ne cílený útok.
     */
    private const COMMON = [
        'heslo123456', 'password12', 'password123', '1234567890', 'qwertyuiop',
        'volejbal12', 'volejbal123', 'pinaprosek', 'skprosek12', 'admin12345',
    ];

    public function hash(string $password): string
    {
        $this->assertStrong($password);

        // Argon2id je na hostingu k dispozici (rozšíření sodium je ověřené).
        return password_hash($password, PASSWORD_ARGON2ID);
    }

    public function verify(string $password, ?string $hash): bool
    {
        if ($hash === null || $hash === '') {
            // Účet bez hesla (pozvaný, ale neaktivovaný). Hash se přesto ověří
            // proti nesmyslu, aby doba odpovědi neprozradila, že účet neexistuje.
            password_verify($password, '$argon2id$v=19$m=65536,t=4,p=1$aaaaaaaaaaaaaaaa$aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa');

            return false;
        }

        return password_verify($password, $hash);
    }

    public function needsRehash(string $hash): bool
    {
        return password_needs_rehash($hash, PASSWORD_ARGON2ID);
    }

    /**
     * Pravidla vycházejí z doporučení NIST: rozhoduje délka, ne vynucené
     * kombinace znaků. „Musí obsahovat číslici“ lidi jen nutí psát Heslo1.
     */
    public function assertStrong(string $password): void
    {
        $length = mb_strlen($password);

        if ($length < self::MIN_LENGTH) {
            throw ApiException::validation(
                sprintf('Heslo musí mít alespoň %d znaků.', self::MIN_LENGTH),
                ['field' => 'password', 'minLength' => self::MIN_LENGTH],
            );
        }

        if ($length > 200) {
            throw ApiException::validation('Heslo je příliš dlouhé.', ['field' => 'password']);
        }

        if (in_array(mb_strtolower($password), self::COMMON, true)) {
            throw ApiException::validation(
                'Tohle heslo je příliš časté, zvolte prosím jiné.',
                ['field' => 'password'],
            );
        }
    }
}
