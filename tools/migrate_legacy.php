<?php
declare(strict_types=1);

/**
 * Migrace dat ze staré databáze (Uzivatel, Tym, Sezona, ...) do schématu Pína 2.0.
 *
 * Vlastnosti:
 *  - idempotentní — opakované spuštění nic neduplikuje (mapování přes legacy_id / legacy_key)
 *  - dávkované — respektuje limit 30 s a 128 MB na produkčním hostingu
 *  - hesla se NEPŘENÁŠEJÍ, uživatelé si nastaví nové z pozvánky
 *
 * Spuštění:
 *   docker compose exec php php tools/migrate_legacy.php [--dry-run]
 */

const BATCH = 500;

/** Rozdělení starých týmů do klubů. Klíč = Tym.id, hodnota = slug klubu. */
const CLUB_MAP = [
    1 => 'sk-prosek',   // Prosek - junioři
    2 => 'sk-prosek',   // Prosek - kadeti
    8 => 'sk-prosek',   // Prosek - muži
    7 => 'vk-benatky',  // VK Benátky
];

const CLUB_NAMES = [
    'sk-prosek'  => 'SK Prosek Praha',
    'vk-benatky' => 'VK Benátky',
];

/** Starý „superadmin“ byl natvrdo uživatel s id 1. */
const LEGACY_PLATFORM_ADMIN_ID = 1;

/** @var list<string> $args */
$args   = $argv ?? [];
$dryRun = in_array('--dry-run', $args, true);

$dsn = sprintf('mysql:host=%s;dbname=%s;charset=utf8mb4', env('DB_HOST', 'db'), env('DB_NAME', 'pina'));
$pdo = new PDO($dsn, env('DB_USER', 'pina'), env('DB_PASSWORD', 'pina'), [
    PDO::ATTR_ERRMODE            => PDO::ERRMODE_EXCEPTION,
    PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
    PDO::ATTR_EMULATE_PREPARES   => false,
]);
$legacyDb = env('LEGACY_DB', 'legacy');

info("Migrace ze schématu `$legacyDb` do `" . env('DB_NAME', 'pina') . "`" . ($dryRun ? ' [DRY RUN]' : ''));

$pdo->beginTransaction();
try {
    $clubs       = migrateClubs($pdo);
    $teams       = migrateTeams($pdo, $legacyDb, $clubs);
    $users       = migrateUsers($pdo, $legacyDb);
    $memberships = migrateMemberships($pdo, $legacyDb, $users, $teams);
    $seasons     = migrateSeasons($pdo, $legacyDb, $teams);
    migrateRoster($pdo, $legacyDb, $seasons, $memberships);
    $types       = migrateOffenceTypes($pdo, $legacyDb, $seasons);
    migrateOffences($pdo, $legacyDb, $seasons, $memberships, $types);

    if ($dryRun) {
        $pdo->rollBack();
        info('DRY RUN — změny vráceny zpět.');
    } else {
        $pdo->commit();
        info('Hotovo.');
    }
} catch (Throwable $e) {
    $pdo->rollBack();
    fwrite(STDERR, "CHYBA: {$e->getMessage()}\n{$e->getTraceAsString()}\n");
    exit(1);
}

// ---------------------------------------------------------------- kroky

/** @return array<string,int> slug => club.id */
function migrateClubs(PDO $pdo): array
{
    $out = [];
    foreach (CLUB_NAMES as $slug => $name) {
        $id = fetchOne($pdo, 'SELECT id FROM club WHERE slug = ?', [$slug]);
        if ($id === null) {
            $pdo->prepare('INSERT INTO club (name, slug) VALUES (?, ?)')->execute([$name, $slug]);
            $id = (int) $pdo->lastInsertId();
        }
        $out[$slug] = (int) $id;
    }
    info('kluby: ' . count($out));
    return $out;
}

/**
 * @param  array<string,int> $clubs slug => club.id
 * @return array<int,int>   Tym.id => team.id
 */
function migrateTeams(PDO $pdo, string $legacy, array $clubs): array
{
    $out = [];
    foreach (rows($pdo, "SELECT id, nazev FROM `$legacy`.Tym ORDER BY id") as $row) {
        $legacyId = (int) $row['id'];
        $slug     = CLUB_MAP[$legacyId] ?? throw new RuntimeException("Tým $legacyId nemá přiřazený klub v CLUB_MAP");
        $clubId   = $clubs[$slug];

        $id = fetchOne($pdo, 'SELECT id FROM team WHERE club_id = ? AND name = ?', [$clubId, $row['nazev']]);
        if ($id === null) {
            $pdo->prepare('INSERT INTO team (club_id, name) VALUES (?, ?)')->execute([$clubId, $row['nazev']]);
            $id = (int) $pdo->lastInsertId();
        }
        $out[$legacyId] = (int) $id;
    }
    info('týmy: ' . count($out));
    return $out;
}

/** @return array<int,int> Uzivatel.id => user.id */
function migrateUsers(PDO $pdo, string $legacy): array
{
    $out = [];
    $ins = $pdo->prepare(
        'INSERT INTO `user` (email, display_name, password_hash, is_platform_admin, legacy_id)
         VALUES (?, ?, NULL, ?, ?)
         ON DUPLICATE KEY UPDATE display_name = VALUES(display_name), id = LAST_INSERT_ID(id)'
    );

    foreach (rows($pdo, "SELECT id, jmeno, email FROM `$legacy`.Uzivatel ORDER BY id") as $row) {
        $legacyId = (int) $row['id'];
        $email    = trim((string) $row['email']);
        if ($email === '') {
            // Účet bez e-mailu nelze pozvat; zakládá se se zástupnou adresou, aby nezmizel z historie.
            $email = "legacy-$legacyId@pinaprosek.invalid";
            warn("uživatel $legacyId nemá e-mail, používá se $email");
        }
        $ins->execute([$email, $row['jmeno'], $legacyId === LEGACY_PLATFORM_ADMIN_ID ? 1 : 0, $legacyId]);
        $out[$legacyId] = (int) $pdo->lastInsertId();
    }
    info('uživatelé: ' . count($out) . ' (hesla se nepřenášejí)');
    return $out;
}

/**
 * @param  array<int,int>    $users
 * @param  array<int,int>    $teams
 * @return array<string,int>
 */
function migrateMemberships(PDO $pdo, string $legacy, array $users, array $teams): array
{
    $adminOf = [];
    foreach (rows($pdo, "SELECT id, admin FROM `$legacy`.Uzivatel WHERE admin IS NOT NULL") as $row) {
        $adminOf[(int) $row['id']] = (int) $row['admin'];
    }

    $out = [];
    $ins = $pdo->prepare(
        'INSERT INTO membership (user_id, team_id, role, payment_reference, status)
         VALUES (?, ?, ?, ?, ?)
         ON DUPLICATE KEY UPDATE role = VALUES(role), status = VALUES(status), id = LAST_INSERT_ID(id)'
    );

    $rows = rows($pdo, "SELECT idUzivatel, idTym, pozastaven FROM `$legacy`.UzivatelTym ORDER BY idUzivatel, idTym");
    foreach ($rows as $row) {
        $lu = (int) $row['idUzivatel'];
        $lt = (int) $row['idTym'];
        if (!isset($users[$lu], $teams[$lt])) {
            warn("členství $lu/$lt odkazuje na neexistující záznam, přeskakuji");
            continue;
        }
        $role   = ($adminOf[$lu] ?? null) === $lt ? 'admin' : 'player';
        $status = ((int) $row['pozastaven'] === 1) ? 'suspended' : 'active';

        $ins->execute([$users[$lu], $teams[$lt], $role, paymentReference($teams[$lt], $users[$lu]), $status]);
        $out["$lu:$lt"] = (int) $pdo->lastInsertId();
    }
    $direct = count($out);

    // Stará DB neměla funkční cizí klíče, takže existují zápisy a soupisky pro dvojice
    // hráč+tým, které v UzivatelTym chybí (hráč byl z týmu odebrán, jeho data zůstala).
    // Aby se historie neztratila, členství se dopočítá a označí jako 'left'.
    $orphans = rows($pdo,
        "SELECT DISTINCT idUzivatel, idTym FROM (
             SELECT idUzivatel, idTym FROM `$legacy`.Prohresek
             UNION SELECT idUzivatel, idTym FROM `$legacy`.UzivatelSezona
         ) x
         WHERE NOT EXISTS (
             SELECT 1 FROM `$legacy`.UzivatelTym ut
             WHERE ut.idUzivatel = x.idUzivatel AND ut.idTym = x.idTym
         )"
    );
    $recovered = 0;
    foreach ($orphans as $row) {
        $lu = (int) $row['idUzivatel'];
        $lt = (int) $row['idTym'];
        if (!isset($users[$lu], $teams[$lt]) || isset($out["$lu:$lt"])) {
            continue;
        }
        $ins->execute([$users[$lu], $teams[$lt], 'player', paymentReference($teams[$lt], $users[$lu]), 'left']);
        $out["$lu:$lt"] = (int) $pdo->lastInsertId();
        $recovered++;
        warn("dopočteno členství hráče $lu v týmu $lt (chybělo v UzivatelTym) → status 'left'");
    }

    info("členství: $direct" . ($recovered ? " + $recovered dopočtených bývalých členů" : ''));
    return $out;
}

/**
 * @param  array<int,int>    $teams
 * @return array<string,int>
 */
function migrateSeasons(PDO $pdo, string $legacy, array $teams): array
{
    $out = [];
    $ins = $pdo->prepare(
        'INSERT INTO season (team_id, name, starts_on, ends_on, is_current, closed_at, legacy_key)
         VALUES (?, ?, ?, ?, ?, ?, ?)
         ON DUPLICATE KEY UPDATE starts_on = VALUES(starts_on), ends_on = VALUES(ends_on), id = LAST_INSERT_ID(id)'
    );
    $today = date('Y-m-d');

    $rows = rows($pdo, "SELECT id, idTym, DatumOd, DatumDo FROM `$legacy`.Sezona ORDER BY idTym, DatumOd");
    foreach ($rows as $row) {
        $lt = (int) $row['idTym'];
        if (!isset($teams[$lt])) {
            warn("sezóna {$row['id']} odkazuje na neexistující tým $lt, přeskakuji");
            continue;
        }
        $key       = $row['id'] . '|' . $lt;
        $isCurrent = ($row['DatumOd'] <= $today && $today <= $row['DatumDo']) ? 1 : 0;
        // Skončené sezóny se rovnou uzavírají — zpětný zápis do nich nedává smysl.
        $closedAt  = $row['DatumDo'] < $today ? $row['DatumDo'] . ' 23:59:59' : null;

        $ins->execute([$teams[$lt], $row['id'], $row['DatumOd'], $row['DatumDo'], $isCurrent, $closedAt, $key]);
        $out[$key] = (int) $pdo->lastInsertId();
    }
    info('sezóny: ' . count($out));
    return $out;
}

/**
 * @param array<string,int> $seasons
 * @param array<string,int> $memberships
 */
function migrateRoster(PDO $pdo, string $legacy, array $seasons, array $memberships): void
{
    $ins = $pdo->prepare(
        'INSERT IGNORE INTO roster_entry (season_id, membership_id) VALUES (?, ?)'
    );
    $n = $skipped = 0;

    $rows = rows($pdo, "SELECT idTym, idUzivatel, idSezona FROM `$legacy`.UzivatelSezona");
    foreach ($rows as $row) {
        $seasonId     = $seasons[$row['idSezona'] . '|' . (int) $row['idTym']] ?? null;
        $membershipId = $memberships[(int) $row['idUzivatel'] . ':' . (int) $row['idTym']] ?? null;
        if ($seasonId === null || $membershipId === null) {
            $skipped++;
            continue;
        }
        $ins->execute([$seasonId, $membershipId]);
        $n++;
    }
    info("soupisky: $n" . ($skipped ? " (přeskočeno $skipped osiřelých)" : ''));
}

/**
 * @param  array<string,int> $seasons
 * @return array<int,int>
 */
function migrateOffenceTypes(PDO $pdo, string $legacy, array $seasons): array
{
    $out = [];
    $ins = $pdo->prepare(
        'INSERT INTO offence_type (season_id, name, amount_czk, sort_order, legacy_id)
         VALUES (?, ?, ?, ?, ?)
         ON DUPLICATE KEY UPDATE name = VALUES(name), amount_czk = VALUES(amount_czk), id = LAST_INSERT_ID(id)'
    );
    $skipped = 0;

    $rows = rows($pdo, "SELECT id, idSezona, idTym, nazev, castka, poradi FROM `$legacy`.ProhreskySeznam ORDER BY id");
    foreach ($rows as $row) {
        $seasonId = $seasons[$row['idSezona'] . '|' . (int) $row['idTym']] ?? null;
        if ($seasonId === null) {
            // Položky s prázdnou nebo smazanou sezónou. Ověřeno, že na nich nevisí
            // žádný zápis — jde o nedokončené záznamy, není kam je zařadit.
            $skipped++;
            warn(sprintf(
                'sazebník #%d "%s" (tým %d, sezóna "%s") nemá platnou sezónu → vynecháno',
                $row['id'], $row['nazev'], $row['idTym'], $row['idSezona']
            ));
            continue;
        }
        $ins->execute([$seasonId, $row['nazev'], (int) $row['castka'], (int) $row['poradi'], (int) $row['id']]);
        $out[(int) $row['id']] = (int) $pdo->lastInsertId();
    }
    info('sazebník: ' . count($out) . ($skipped ? " (přeskočeno $skipped bez sezóny)" : ''));
    return $out;
}

/**
 * Zápisy prohřešků. Částka se bere ze sazebníku TÉŽE sezóny → historicky přesná,
 * protože starý model vedl ceny per sezónu.
 */
/**
 * @param array<string,int> $seasons
 * @param array<string,int> $memberships
 * @param array<int,int>    $types
 */
function migrateOffences(PDO $pdo, string $legacy, array $seasons, array $memberships, array $types): void
{
    $amounts = [];
    foreach (rows($pdo, 'SELECT legacy_id, amount_czk FROM offence_type WHERE legacy_id IS NOT NULL') as $row) {
        $amounts[(int) $row['legacy_id']] = (int) $row['amount_czk'];
    }

    $ins = $pdo->prepare(
        'INSERT INTO offence_record
            (season_id, membership_id, offence_type_id, amount_czk, occurred_on, created_at, legacy_id)
         VALUES (?, ?, ?, ?, ?, ?, ?)
         ON DUPLICATE KEY UPDATE amount_czk = VALUES(amount_czk)'
    );

    $total = (int) stmt($pdo, "SELECT COUNT(*) FROM `$legacy`.Prohresek")->fetchColumn();
    $done = $skipped = 0;

    for ($offset = 0; $offset < $total; $offset += BATCH) {
        $rows = rows($pdo, 
            "SELECT id, idProhresek, idUzivatel, idTym, idSezona, Datum
             FROM `$legacy`.Prohresek ORDER BY id LIMIT " . BATCH . " OFFSET $offset"
        );
        foreach ($rows as $row) {
            $seasonId     = $seasons[$row['idSezona'] . '|' . (int) $row['idTym']] ?? null;
            $membershipId = $memberships[(int) $row['idUzivatel'] . ':' . (int) $row['idTym']] ?? null;
            $typeId       = $types[(int) $row['idProhresek']] ?? null;

            if ($seasonId === null || $membershipId === null || $typeId === null) {
                $skipped++;
                continue;
            }
            $ins->execute([
                $seasonId,
                $membershipId,
                $typeId,
                $amounts[(int) $row['idProhresek']] ?? 0,
                substr((string) $row['Datum'], 0, 10),
                $row['Datum'],
                (int) $row['id'],
            ]);
            $done++;
        }
        info("  prohřešky: $done / $total");
    }
    info("prohřešky: $done" . ($skipped ? " (přeskočeno $skipped osiřelých)" : ''));
}

// ---------------------------------------------------------------- pomocné

/** Stabilní variabilní symbol: 8 číslic, tým + uživatel + kontrolní číslice (mod 11). */
function paymentReference(int $teamId, int $userId): string
{
    $base = sprintf('%03d%04d', $teamId % 1000, $userId % 10000);
    $sum  = 0;
    foreach (str_split($base) as $i => $digit) {
        $sum += (int) $digit * (($i % 6) + 2);
    }
    return $base . ($sum % 11 % 10);
}

/** @param array<int,scalar> $params */
/**
 * PDO s ERRMODE_EXCEPTION nikdy nevrátí false, ale staticky se to ověřit nedá.
 */
function stmt(PDO $pdo, string $sql): PDOStatement
{
    $statement = $pdo->query($sql);
    if ($statement === false) {
        throw new RuntimeException("Dotaz selhal: $sql");
    }

    return $statement;
}

/** @return iterable<array<string,mixed>> */
function rows(PDO $pdo, string $sql): iterable
{
    return stmt($pdo, $sql);
}

/** @param list<scalar> $params */
function fetchOne(PDO $pdo, string $sql, array $params): ?string
{
    $st = $pdo->prepare($sql);
    $st->execute($params);
    $value = $st->fetchColumn();
    return $value === false ? null : (string) $value;
}

function env(string $key, string $default): string
{
    return getenv($key) ?: $default;
}

function info(string $msg): void
{
    fwrite(STDOUT, "  $msg\n");
}

function warn(string $msg): void
{
    fwrite(STDERR, "  ! $msg\n");
}
