<?php

declare(strict_types=1);

namespace Pina\Support;

use Dotenv\Dotenv;
use RuntimeException;

/**
 * Konfigurace z .env. Nahrazuje připojovací údaje roztroušené po 45 souborech,
 * jak to bylo ve staré verzi.
 */
final class Config
{
    /** @var array<string,string> */
    private static array $values = [];

    private static bool $loaded = false;

    public static function load(string $rootPath): void
    {
        if (self::$loaded) {
            return;
        }

        if (is_file($rootPath . '/.env')) {
            Dotenv::createImmutable($rootPath)->load();
        }

        self::$values = array_map(strval(...), $_ENV);
        self::$loaded = true;
    }

    public static function get(string $key, ?string $default = null): string
    {
        $value = self::$values[$key] ?? null;

        if ($value === null || $value === '') {
            $fromEnv = getenv($key);
            $value   = $fromEnv === false || $fromEnv === '' ? $default : $fromEnv;
        }

        if ($value === null) {
            throw new RuntimeException("Chybí konfigurační hodnota $key (viz .env.example).");
        }

        return $value;
    }

    public static function bool(string $key, bool $default = false): bool
    {
        $value = strtolower(self::get($key, $default ? 'true' : 'false'));

        return in_array($value, ['1', 'true', 'yes', 'on'], true);
    }

    public static function int(string $key, ?int $default = null): int
    {
        return (int) self::get($key, $default === null ? null : (string) $default);
    }

    public static function isProduction(): bool
    {
        return self::get('APP_ENV', 'production') === 'production';
    }

    public static function isDebug(): bool
    {
        return self::bool('APP_DEBUG') && !self::isProduction();
    }
}
