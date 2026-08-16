<?php

declare(strict_types=1);

namespace Pina\Http;

use Pina\Auth\Identity;

/**
 * Příchozí HTTP požadavek. Vstupy se čtou výhradně přes typované metody,
 * aby se nikde nepracovalo přímo se superglobály.
 */
final class Request
{
    /** @var array<string,string> */
    public array $routeParams = [];

    public ?Identity $identity = null;

    /**
     * @param array<string,mixed>  $query
     * @param array<string,mixed>  $body
     * @param array<string,string> $headers
     */
    public function __construct(
        public readonly string $method,
        public readonly string $path,
        public readonly array $query,
        public readonly array $body,
        public readonly array $headers,
        public readonly string $ip,
    ) {
    }

    public static function fromGlobals(): self
    {
        $headers = [];
        foreach ($_SERVER as $key => $value) {
            if (str_starts_with((string) $key, 'HTTP_')) {
                $name = strtolower(str_replace('_', '-', substr((string) $key, 5)));
                $headers[$name] = (string) $value;
            }
        }
        if (isset($_SERVER['CONTENT_TYPE'])) {
            $headers['content-type'] = (string) $_SERVER['CONTENT_TYPE'];
        }

        $raw  = file_get_contents('php://input') ?: '';
        $body = [];
        if ($raw !== '' && str_contains($headers['content-type'] ?? '', 'application/json')) {
            $decoded = json_decode($raw, true);
            $body    = is_array($decoded) ? $decoded : [];
        }

        $path = parse_url((string) ($_SERVER['REQUEST_URI'] ?? '/'), PHP_URL_PATH) ?: '/';

        return new self(
            method:  strtoupper((string) ($_SERVER['REQUEST_METHOD'] ?? 'GET')),
            path:    rtrim($path, '/') ?: '/',
            query:   $_GET,
            body:    $body,
            headers: $headers,
            ip:      (string) ($_SERVER['REMOTE_ADDR'] ?? ''),
        );
    }

    public function header(string $name): ?string
    {
        return $this->headers[strtolower($name)] ?? null;
    }

    public function bearerToken(): ?string
    {
        $value = $this->header('authorization');

        return $value !== null && preg_match('/^Bearer\s+(.+)$/i', $value, $m) === 1 ? $m[1] : null;
    }

    public function routeId(string $name): int
    {
        $value = $this->routeParams[$name] ?? '';

        if (!ctype_digit($value) || (int) $value <= 0) {
            throw ApiException::notFound();
        }

        return (int) $value;
    }

    public function string(string $key, ?string $default = null): string
    {
        $value = $this->body[$key] ?? $default;

        if (!is_string($value) || trim($value) === '') {
            throw ApiException::validation("Pole $key je povinné.", ['field' => $key]);
        }

        return trim($value);
    }

    public function optionalString(string $key): ?string
    {
        $value = $this->body[$key] ?? null;

        return is_string($value) && trim($value) !== '' ? trim($value) : null;
    }

    public function int(string $key): int
    {
        $value = $this->body[$key] ?? null;

        if (!is_int($value) && !(is_string($value) && ctype_digit($value))) {
            throw ApiException::validation("Pole $key musí být číslo.", ['field' => $key]);
        }

        return (int) $value;
    }

    /**
     * Celé číslo, které smí být záporné. Částky v sazebníku jsou se znaménkem —
     * záporná hodnota je bonus („MVP extraligy" −20 Kč), takže na ně `int()`
     * s kontrolou `ctype_digit` nestačí.
     */
    public function signedInt(string $key, ?int $default = null): int
    {
        $value = $this->body[$key] ?? $default;

        if (is_int($value)) {
            return $value;
        }

        if (is_string($value) && preg_match('/^-?\d+$/', trim($value)) === 1) {
            return (int) trim($value);
        }

        throw ApiException::validation("Pole $key musí být celé číslo.", ['field' => $key]);
    }

    public function optionalSignedInt(string $key): ?int
    {
        $value = $this->body[$key] ?? null;

        return $value === null || $value === '' ? null : $this->signedInt($key);
    }

    public function bool(string $key, bool $default = false): bool
    {
        $value = $this->body[$key] ?? $default;

        return filter_var($value, FILTER_VALIDATE_BOOL);
    }

    /** @return list<mixed> */
    public function array(string $key): array
    {
        $value = $this->body[$key] ?? null;

        if (!is_array($value)) {
            throw ApiException::validation("Pole $key musí být seznam.", ['field' => $key]);
        }

        return array_values($value);
    }

    public function queryString(string $key, ?string $default = null): ?string
    {
        $value = $this->query[$key] ?? $default;

        return is_string($value) && $value !== '' ? $value : $default;
    }

    public function queryInt(string $key, ?int $default = null): ?int
    {
        $value = $this->query[$key] ?? null;

        return is_string($value) && ctype_digit($value) ? (int) $value : $default;
    }

    /** Přihlášený uživatel; volá se až za auth middlewarem. */
    public function identity(): Identity
    {
        return $this->identity ?? throw ApiException::unauthenticated();
    }
}
