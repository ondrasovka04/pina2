<?php

declare(strict_types=1);

/**
 * Jediný vstupní bod API. Nahrazuje ~45 samostatných PHP skriptů staré verze.
 * Apache sem posílá vše přes .htaccess rewrite.
 *
 * Na hostingu leží tento soubor v public_html/api/, zatímco zbytek aplikace
 * (src, vendor, .env, storage) je mimo dosah webu.
 */

use Pina\App;
use Pina\Http\Request;

// Kořen se nehledá relativně nastálo: ve vývoji je o patro výš (api/), na
// hostingu Zoneru leží v data/app/, protože web root ani jeho rodič nejsou pro
// PHP zapisovatelné a storage/images/ zapisovatelný adresář potřebuje.
$root = null;

foreach ([dirname(__DIR__), dirname(__DIR__, 2) . '/data/app'] as $candidate) {
    if (is_file($candidate . '/vendor/autoload.php')) {
        $root = $candidate;
        break;
    }
}

if ($root === null) {
    http_response_code(500);
    header('Content-Type: application/json');
    echo '{"error":{"code":"MISCONFIGURED","message":"Aplikace nenašla svůj kořen s vendor/autoload.php."}}';
    exit;
}

require $root . '/vendor/autoload.php';

$app = new App($root);

$app->kernel()->handle(Request::fromGlobals())->send();
