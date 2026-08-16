<?php

declare(strict_types=1);

namespace Pina\Support;

use Throwable;

/**
 * Zápis chyb do souboru. Na hostingu je `log_errors` vypnuté a `error_log`
 * prázdný, takže bez tohoto by chyby zmizely beze stopy.
 */
final class Logger
{
    public function __construct(private readonly string $directory)
    {
    }

    /** @param array<string,mixed> $context */
    public function error(Throwable $e, array $context = []): void
    {
        $this->write('ERROR', $e->getMessage(), [
            ...$context,
            'exception' => $e::class,
            'file'      => $e->getFile() . ':' . $e->getLine(),
            'trace'     => array_slice(explode("\n", $e->getTraceAsString()), 0, 10),
        ]);
    }

    /** @param array<string,mixed> $context */
    public function info(string $message, array $context = []): void
    {
        $this->write('INFO', $message, $context);
    }

    /** @param array<string,mixed> $context */
    private function write(string $level, string $message, array $context): void
    {
        if (!is_dir($this->directory) && !@mkdir($this->directory, 0o750, true) && !is_dir($this->directory)) {
            return;
        }

        $line = sprintf(
            "[%s] %s: %s %s\n",
            date('Y-m-d H:i:s'),
            $level,
            $message,
            json_encode($context, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES),
        );

        @file_put_contents(
            $this->directory . '/' . date('Y-m-d') . '.log',
            $line,
            FILE_APPEND | LOCK_EX,
        );
    }
}
