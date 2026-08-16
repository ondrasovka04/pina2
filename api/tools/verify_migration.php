<?php
declare(strict_types=1);

/**
 * Ověření migrace: porovná starou a novou databázi.
 *
 * Kontroluje počty řádků, součty částek po sezónách a po hráčích. Rozdíl kdekoli
 * znamená, že migrace neproběhla čistě — u dat o penězích je to blokující.
 *
 * Spuštění:
 *   docker compose exec php php tools/verify_migration.php
 * Návratový kód 0 = vše sedí, 1 = nalezen rozdíl.
 */

$dsn = sprintf('mysql:host=%s;charset=utf8mb4', getenv('DB_HOST') ?: 'db');
$pdo = new PDO($dsn, getenv('DB_USER') ?: 'root', getenv('DB_PASSWORD') ?: 'root', [
    PDO::ATTR_ERRMODE            => PDO::ERRMODE_EXCEPTION,
    PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
]);

$legacy = getenv('LEGACY_DB') ?: 'legacy';
$new    = getenv('DB_NAME') ?: 'pina';
$failed = false;

echo "Ověření migrace `$legacy` → `$new`\n\n";

// ---------------------------------------------------------------- počty řádků

$counts = [
    'týmy'      => ["SELECT COUNT(*) FROM `$legacy`.Tym",             "SELECT COUNT(*) FROM `$new`.team"],
    'uživatelé' => ["SELECT COUNT(*) FROM `$legacy`.Uzivatel",        "SELECT COUNT(*) FROM `$new`.`user`"],
    'sezóny'    => ["SELECT COUNT(*) FROM `$legacy`.Sezona",          "SELECT COUNT(*) FROM `$new`.season"],
    'soupisky'  => ["SELECT COUNT(*) FROM `$legacy`.UzivatelSezona",  "SELECT COUNT(*) FROM `$new`.roster_entry"],
    'prohřešky' => ["SELECT COUNT(*) FROM `$legacy`.Prohresek",       "SELECT COUNT(*) FROM `$new`.offence_record"],
];

echo "POČTY ZÁZNAMŮ\n";
foreach ($counts as $label => [$oldSql, $newSql]) {
    $old = (int) stmt($pdo, $oldSql)->fetchColumn();
    $cur = (int) stmt($pdo, $newSql)->fetchColumn();
    report($label, $old, $cur, $failed);
}

// Členství: nová DB má navíc dopočtené bývalé členy, proto se porovnává jen podmnožina.
$oldMemberships = (int) stmt($pdo, "SELECT COUNT(*) FROM `$legacy`.UzivatelTym")->fetchColumn();
$newMemberships = (int) stmt($pdo, "SELECT COUNT(*) FROM `$new`.membership")->fetchColumn();
$recovered      = (int) stmt($pdo, "SELECT COUNT(*) FROM `$new`.membership WHERE status = 'left'")->fetchColumn();
printf("  %-28s %6d → %6d  %s\n", 'členství', $oldMemberships, $newMemberships,
    $newMemberships - $oldMemberships === $recovered ? "OK (+$recovered dopočtených)" : 'NESEDÍ');
if ($newMemberships - $oldMemberships !== $recovered) {
    $failed = true;
}

// ---------------------------------------------------------------- peníze

echo "\nSOUČTY ČÁSTEK PO SEZÓNÁCH\n";

$newSums = stmt($pdo, 
    "SELECT s.legacy_key AS k, COUNT(*) AS n, SUM(o.amount_czk) AS suma
     FROM `$new`.offence_record o
     JOIN `$new`.season s ON s.id = o.season_id
     WHERE o.voided_at IS NULL
     GROUP BY s.legacy_key"
)->fetchAll();

$newByKey = [];
foreach ($newSums as $row) {
    $newByKey[$row['k']] = $row;
}

$oldByKey = stmt($pdo, 
    "SELECT CONCAT(p.idSezona, '|', p.idTym) AS k, COUNT(*) AS n, SUM(ps.castka) AS suma
     FROM `$legacy`.Prohresek p
     JOIN `$legacy`.ProhreskySeznam ps ON ps.id = p.idProhresek
     GROUP BY k"
)->fetchAll();

foreach ($oldByKey as $row) {
    $key = $row['k'];
    $cur = $newByKey[$key] ?? ['n' => 0, 'suma' => 0];
    $ok  = (int) $row['n'] === (int) $cur['n'] && (int) $row['suma'] === (int) $cur['suma'];
    printf("  %-28s %4d zápisů / %8d Kč → %4d / %8d Kč  %s\n",
        $key, $row['n'], $row['suma'], $cur['n'], $cur['suma'], $ok ? 'OK' : '*** NESEDÍ ***');
    if (!$ok) {
        $failed = true;
    }
}

// ---------------------------------------------------------------- po hráčích

echo "\nSOUČTY PO HRÁČÍCH\n";

$mismatch = stmt($pdo, 
    "SELECT u.legacy_id, u.display_name, o.stary, o.novy
     FROM (
         SELECT m.user_id,
                (SELECT COALESCE(SUM(ps.castka), 0)
                   FROM `$legacy`.Prohresek p
                   JOIN `$legacy`.ProhreskySeznam ps ON ps.id = p.idProhresek
                   JOIN `$new`.`user` lu ON lu.legacy_id = p.idUzivatel
                  WHERE lu.id = m.user_id) AS stary,
                SUM(orr.amount_czk) AS novy
           FROM `$new`.membership m
           JOIN `$new`.offence_record orr ON orr.membership_id = m.id AND orr.voided_at IS NULL
          GROUP BY m.user_id
     ) o
     JOIN `$new`.`user` u ON u.id = o.user_id
     WHERE o.stary <> o.novy"
)->fetchAll();

if ($mismatch === []) {
    $total = (int) stmt($pdo, "SELECT SUM(amount_czk) FROM `$new`.offence_record WHERE voided_at IS NULL")->fetchColumn();
    printf("  všichni hráči sedí (celkem %s Kč napříč všemi sezónami)\n", number_format($total, 0, ',', ' '));
} else {
    foreach ($mismatch as $row) {
        printf("  *** %s (legacy #%d): staré %d Kč vs nové %d Kč\n",
            $row['display_name'], $row['legacy_id'], $row['stary'], $row['novy']);
    }
    $failed = true;
}

// ---------------------------------------------------------------- integrita

echo "\nINTEGRITA NOVÝCH DAT\n";
$checks = [
    'prohřešky bez členství'      => "SELECT COUNT(*) FROM `$new`.offence_record o LEFT JOIN `$new`.membership m ON m.id = o.membership_id WHERE m.id IS NULL",
    'prohřešky mimo svou sezónu'  => "SELECT COUNT(*) FROM `$new`.offence_record o JOIN `$new`.offence_type t ON t.id = o.offence_type_id WHERE t.season_id <> o.season_id",
    'členství s duplicitním VS'   => "SELECT COUNT(*) - COUNT(DISTINCT payment_reference) FROM `$new`.membership",
    'sezóny bez týmu'             => "SELECT COUNT(*) FROM `$new`.season s LEFT JOIN `$new`.team t ON t.id = s.team_id WHERE t.id IS NULL",
];
foreach ($checks as $label => $sql) {
    $n = (int) stmt($pdo, $sql)->fetchColumn();
    printf("  %-28s %s\n", $label, $n === 0 ? 'OK' : "*** $n ***");
    if ($n !== 0) {
        $failed = true;
    }
}

echo "\n" . ($failed ? "VÝSLEDEK: nalezeny rozdíly\n" : "VÝSLEDEK: vše sedí\n");
exit($failed ? 1 : 0);

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

function report(string $label, int $old, int $new, bool &$failed): void
{
    $ok = $old === $new;
    printf("  %-28s %6d → %6d  %s\n", $label, $old, $new, $ok ? 'OK' : '*** NESEDÍ ***');
    if (!$ok) {
        $failed = true;
    }
}
