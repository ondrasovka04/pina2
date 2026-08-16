<?php

declare(strict_types=1);

/**
 * Jediný vstupní bod API. Nahrazuje ~45 samostatných PHP skriptů staré verze.
 * Apache sem posílá vše přes .htaccess rewrite.
 */

use Pina\App;
use Pina\Http\Request;

require dirname(__DIR__, 2) . '/vendor/autoload.php';

$app = new App(dirname(__DIR__, 2));

$app->kernel()->handle(Request::fromGlobals())->send();
