<?php

declare(strict_types=1);

namespace Pina\Http;

use RuntimeException;

/**
 * Chyba s jednotným tvarem odpovědi. Stará verze vracela 400 úplně na všechno,
 * takže klient nedokázal rozlišit chybný vstup od chybějícího oprávnění.
 */
class ApiException extends RuntimeException
{
    /** @param array<string,mixed> $details */
    public function __construct(
        public readonly int $status,
        public readonly string $errorCode,
        string $message,
        public readonly array $details = [],
    ) {
        parent::__construct($message);
    }

    /** @param array<string,mixed> $details */
    public static function validation(string $message, array $details = []): self
    {
        return new self(400, 'VALIDATION_FAILED', $message, $details);
    }

    public static function unauthenticated(string $message = 'Přihlaste se prosím znovu.'): self
    {
        return new self(401, 'UNAUTHENTICATED', $message);
    }

    public static function forbidden(string $message = 'K této akci nemáte oprávnění.'): self
    {
        return new self(403, 'FORBIDDEN', $message);
    }

    /**
     * Pozor: používá se i tam, kde záznam existuje, ale nepatří volajícímu klubu.
     * Rozlišovat 403 a 404 by prozradilo, která cizí ID existují.
     */
    public static function notFound(string $message = 'Záznam nebyl nalezen.'): self
    {
        return new self(404, 'NOT_FOUND', $message);
    }

    /** @param array<string,mixed> $details */
    public static function conflict(string $code, string $message, array $details = []): self
    {
        return new self(409, $code, $message, $details);
    }

    public static function tooManyRequests(string $message, int $retryAfter): self
    {
        return new self(429, 'TOO_MANY_REQUESTS', $message, ['retryAfter' => $retryAfter]);
    }
}
