<?php

declare(strict_types=1);

namespace Pina\Support;

use DateTimeImmutable;
use DateTimeZone;
use PDO;
use PDOException;
use PDOStatement;

/** Tenká vrstva nad PDO: všechny dotazy přes prepared statements. */
final class Database
{
    private ?PDO $pdo = null;

    public function pdo(): PDO
    {
        if ($this->pdo instanceof PDO) {
            return $this->pdo;
        }

        $dsn = sprintf(
            'mysql:host=%s;dbname=%s;charset=utf8mb4',
            Config::get('DB_HOST'),
            Config::get('DB_NAME'),
        );

        // Emulované prepared statements: MySQL na hostingu má malou cache definic
        // tabulek a serverový statement, který sahá na víc tabulek (DELETE akce
        // s kaskádami, push odběr), zneplatňoval — po třech marných pokusech
        // vracel chybu 1615 a akce se nedala smazat vůbec. Hodnoty dál escapuje
        // PDO podle charsetu z DSN; čísla váže `run()` jako čísla, kvůli LIMIT ?.
        $pdo = new PDO($dsn, Config::get('DB_USER'), Config::get('DB_PASSWORD'), [
            PDO::ATTR_ERRMODE            => PDO::ERRMODE_EXCEPTION,
            PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
            PDO::ATTR_EMULATE_PREPARES   => true,
            PDO::ATTR_STRINGIFY_FETCHES  => false,
        ]);

        $this->setTimeZone($pdo);
        $this->pdo = $pdo;

        return $pdo;
    }

    /**
     * Pevné „+02:00" bylo v zimě o hodinu napřed. U docházky to vadí: akce by
     * podle serveru začala dřív, než se sejde tým, a hráči by se přestali moci
     * zaklikávat. Zkusí se proto pojmenovaná zóna a teprve když ji MySQL nezná
     * (na sdíleném hostingu bývají tabulky zón prázdné), spočítá se aktuální
     * posun v PHP.
     */
    private function setTimeZone(PDO $pdo): void
    {
        try {
            $pdo->exec("SET time_zone = 'Europe/Prague'");

            return;
        } catch (PDOException) {
            $offset = (new DateTimeImmutable('now', new DateTimeZone('Europe/Prague')))->format('P');

            $pdo->exec("SET time_zone = '$offset'");
        }
    }

    /** @param array<string|int,mixed> $params */
    public function run(string $sql, array $params = []): PDOStatement
    {
        $statement = $this->pdo()->prepare($sql);

        // Emulace by bez typu poslala číslo v uvozovkách a `LIMIT '500'` je
        // syntaktická chyba.
        $position = 0;

        foreach ($params as $key => $value) {
            $parameter = is_int($key) ? ++$position : (str_starts_with($key, ':') ? $key : ":$key");

            match (true) {
                $value === null => $statement->bindValue($parameter, null, PDO::PARAM_NULL),
                is_bool($value) => $statement->bindValue($parameter, (int) $value, PDO::PARAM_INT),
                is_int($value)  => $statement->bindValue($parameter, $value, PDO::PARAM_INT),
                default         => $statement->bindValue($parameter, $value),
            };
        }

        $statement->execute();

        return $statement;
    }

    /**
     * @param  array<string|int,mixed>   $params
     * @return array<string,mixed>|null
     */
    public function first(string $sql, array $params = []): ?array
    {
        $row = $this->run($sql, $params)->fetch();

        return $row === false ? null : $row;
    }

    /**
     * @param  array<string|int,mixed>          $params
     * @return list<array<string,mixed>>
     */
    public function all(string $sql, array $params = []): array
    {
        /** @var list<array<string,mixed>> $rows */
        $rows = $this->run($sql, $params)->fetchAll();

        return $rows;
    }

    /** @param array<string|int,mixed> $params */
    public function value(string $sql, array $params = []): mixed
    {
        $value = $this->run($sql, $params)->fetchColumn();

        return $value === false ? null : $value;
    }

    public function lastInsertId(): int
    {
        return (int) $this->pdo()->lastInsertId();
    }

    /**
     * Zápis do víc tabulek (dávka, platba se stornem): všechno, nebo nic.
     *
     * @template T
     * @param  callable(): T $callback
     * @return T
     */
    public function transaction(callable $callback): mixed
    {
        $pdo = $this->pdo();
        $pdo->beginTransaction();

        try {
            $result = $callback();
            $pdo->commit();

            return $result;
        } catch (\Throwable $e) {
            if ($pdo->inTransaction()) {
                $pdo->rollBack();
            }

            throw $e;
        }
    }
}
