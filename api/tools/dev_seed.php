<?php

declare(strict_types=1);

/**
 * Připraví lokální prostředí na klikání.
 *
 * Migrovaná data se nedají rovnou používat ze dvou důvodů: staré hashe hesel
 * (SHA-256 bez soli) se nepřenášely, takže se nikdo nepřihlásí, a žádná sezóna
 * není označená jako aktuální, protože ta poslední skončila v červnu. Skript
 * obojí srovná.
 *
 *   docker compose run --rm php php tools/dev_seed.php ondra@copymail.cz tajneheslo123
 *
 * Běží **jen** proti APP_ENV=local. V produkci se hesla nastavují přes pozvánku.
 */

require dirname(__DIR__) . '/vendor/autoload.php';

use Pina\Auth\PasswordService;
use Pina\Support\Config;
use Pina\Support\Database;

Config::load(dirname(__DIR__));

if (Config::get('APP_ENV') !== 'local') {
    fwrite(STDERR, "Odmítám běžet mimo APP_ENV=local.\n");
    exit(1);
}

$email    = $argv[1] ?? null;
$password = $argv[2] ?? null;

if (!is_string($email) || !is_string($password)) {
    fwrite(STDERR, "Použití: php tools/dev_seed.php <e-mail> <heslo>\n");
    exit(1);
}

$db = new Database();

// --- 1. Heslo pro přihlášení ---------------------------------------------

$userId = $db->value('SELECT id FROM `user` WHERE email = ?', [$email]);

if ($userId === null) {
    fwrite(STDERR, "Uživatel $email v databázi není.\n");
    fwrite(STDERR, "K dispozici jsou:\n");

    foreach ($db->all('SELECT email, display_name FROM `user` ORDER BY display_name LIMIT 20') as $row) {
        fwrite(STDERR, sprintf("  %-30s %s\n", $row['email'], $row['display_name']));
    }

    exit(1);
}

$db->run(
    'UPDATE `user` SET password_hash = ?, email_verified_at = COALESCE(email_verified_at, NOW()) WHERE id = ?',
    [(new PasswordService())->hash($password), $userId],
);

printf("Heslo nastaveno pro %s.\n", $email);

// --- 2. Aktuální sezóna u každého družstva --------------------------------

// Poslední sezóna podle data začátku. Bez `is_current` nemá aplikace kam
// zapisovat a všechny obrazovky hlásí, že tým nemá rozjetou sezónu.
$db->run('UPDATE season SET is_current = 0');

$db->run(
    'UPDATE season s
       JOIN (SELECT team_id, MAX(starts_on) AS starts_on FROM season GROUP BY team_id) newest
         ON newest.team_id = s.team_id AND newest.starts_on = s.starts_on
        SET s.is_current = 1',
);

// Migrace uzavřela úplně všechny sezóny, protože i ta poslední už měla datum
// konce v minulosti. Do uzavřené sezóny se ale nedá zapisovat, takže by nešlo
// vyzkoušet hlavní obrazovku — aktuální sezónu proto zase otevřeme.
$db->run('UPDATE season SET closed_at = NULL WHERE is_current = 1');

foreach ($db->all(
    'SELECT t.name AS team, s.name AS season,
            (SELECT COUNT(*) FROM offence_type o WHERE o.season_id = s.id) AS types,
            (SELECT COUNT(*) FROM offence_record r WHERE r.season_id = s.id) AS records
       FROM season s JOIN team t ON t.id = s.team_id
      WHERE s.is_current = 1
      ORDER BY t.name',
) as $row) {
    printf(
        "Aktuální sezóna: %-20s %-12s (%s položek sazebníku, %s zápisů)\n",
        $row['team'],
        $row['season'],
        $row['types'],
        $row['records'],
    );
}

// --- 3. Role, aby šlo vyzkoušet i zápis -----------------------------------

$roles = $db->all(
    'SELECT t.name AS team, m.role
       FROM membership m JOIN team t ON t.id = m.team_id
      WHERE m.user_id = ? ORDER BY t.name',
    [$userId],
);

if ($roles === []) {
    fwrite(STDERR, "\nPozor: tenhle účet není v žádném týmu, uvidí prázdnou aplikaci.\n");
} else {
    print "\nRole v týmech:\n";

    foreach ($roles as $row) {
        printf("  %-20s %s\n", $row['team'], $row['role']);
    }
}
