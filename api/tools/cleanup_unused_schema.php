<?php

declare(strict_types=1);

use Pina\Support\Config;
use Pina\Support\Database;
use Pina\Tools\CleanupUnusedSchema;

if (PHP_SAPI !== 'cli') {
    http_response_code(404);
    exit;
}

require __DIR__ . '/../vendor/autoload.php';
require __DIR__ . '/CleanupUnusedSchema.php';

Config::load(dirname(__DIR__));
$migration  = new CleanupUnusedSchema(new Database());
$apply      = in_array('--apply', $_SERVER['argv'] ?? [], true);
$statements = $apply ? $migration->run() : $migration->plan();

echo $apply ? "Provedené změny:\n" : "Náhled změn (spuštění s --apply):\n";
echo $statements === [] ? "Žádné změny.\n" : implode(";\n", $statements) . ";\n";
