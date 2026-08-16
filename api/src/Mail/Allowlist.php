<?php

declare(strict_types=1);

namespace Pina\Mail;

use Pina\Support\Config;

/**
 * Poslední pojistka mezi vývojem a reálnými adresami.
 * Mimo produkci: prázdný seznam = zákaz (obrácené pravidlo šetří zapomenutí).
 */
final class Allowlist
{
    /** @param list<string> $allowed malými písmeny */
    public function __construct(
        private readonly array $allowed,
        private readonly bool $requireExplicit,
    ) {
    }

    public static function fromConfig(): self
    {
        $allowed = array_values(array_filter(array_map(
            static fn (string $email): string => mb_strtolower(trim($email)),
            explode(',', Config::get('MAIL_ALLOWLIST', '')),
        )));

        return new self($allowed, requireExplicit: !Config::isProduction());
    }

    public function permits(string $email): bool
    {
        if ($this->allowed !== []) {
            return in_array(mb_strtolower(trim($email)), $this->allowed, true);
        }

        return !$this->requireExplicit;
    }

    /** Popis pro log a diagnostiku — bez výpisu adres. */
    public function describe(): string
    {
        if ($this->allowed !== []) {
            return sprintf('omezeno na %d adres', count($this->allowed));
        }

        return $this->requireExplicit ? 'zakázáno (mimo produkci a bez seznamu)' : 'bez omezení';
    }
}
