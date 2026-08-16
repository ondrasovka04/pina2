<?php

declare(strict_types=1);

/**
 * Jediný vstupní bod API. Nahrazuje ~45 samostatných PHP skriptů staré verze.
 * Apache sem posílá vše přes .htaccess rewrite.
 *
 * Na hostingu leží tento soubor v public_html/api/, zatímco zbytek aplikace
 * (src, vendor, .env) je o patro výš, mimo dosah webu.
 */

use Pina\App;
use Pina\Http\Request;

$root = dirname(__DIR__);

require $root . '/vendor/autoload.php';

$app = new App($root);

$app->kernel()->handle(Request::fromGlobals())->send();
