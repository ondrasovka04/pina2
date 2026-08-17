<?php

declare(strict_types=1);

/**
 * Formátování PHP. Doplňuje PHPStan: ten hlídá typy, tohle tvar.
 *
 * Pravidla jsou vědomě konzervativní — kód se doteď formátoval ručně a je
 * konzistentní, takže první běh nemá být velký refaktor. Zarovnávání `=>`
 * se proto zapíná (`align_single_space_minimal`), i když PSR-12 ho nežádá:
 * v kódu už zarovnané je a strojové zrušení by zbytečně přepsalo desítky souborů.
 *
 * Žádné migrační ani risky sady. Ty mění chování, ne jen mezery, a formátovač
 * nemá být tichý refaktor — na to je code review.
 */

use PhpCsFixer\Config;
use PhpCsFixer\Finder;

$finder = Finder::create()
    ->in([__DIR__ . '/src', __DIR__ . '/tests', __DIR__ . '/tools'])
    ->name('*.php');

return (new Config())
    ->setRules([
        '@PSR12' => true,

        // Zarovnané `=>` v polích i `=` v blocích přiřazení — drží se v celém
        // projektu a strojové zrušení by přepsalo 43 z 62 souborů bez užitku.
        'binary_operator_spaces' => ['operators' => [
            '=>' => 'align_single_space_minimal',
            '='  => 'align_single_space_minimal',
        ]],

        // Poslední čárka v rozepsaném poli i volání: diff pak neukazuje řádek,
        // který se změnil jen kvůli přidání čárky na jeho konec.
        'trailing_comma_in_multiline' => ['elements' => ['arrays', 'arguments', 'parameters']],

        'no_unused_imports' => true,
        'ordered_imports'   => ['sort_algorithm' => 'alpha'],
        'single_quote'      => true,
        'no_extra_blank_lines' => ['tokens' => ['extra', 'curly_brace_block', 'square_brace_block']],
    ])
    ->setFinder($finder);
