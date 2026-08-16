<?php

declare(strict_types=1);

namespace Pina\Service;

use Pina\Auth\Identity;
use Pina\Auth\Role;
use Pina\Auth\TeamScope;
use Pina\Http\ApiException;
use Pina\Support\Database;

/**
 * Sazebník prohřešků. Je vázaný na sezónu (a sezóna na tým), takže každé družstvo
 * má vlastní ceník a nová sezóna může začít s jinými cenami, aniž by se sáhlo
 * na historii.
 *
 * `amount_czk` je celé číslo **se znaménkem**: záporná částka je bonus
 * („MVP extraligy" −20 Kč, „Vánoce" −200 Kč). Kladnost se proto nikde nevaliduje.
 *
 * Položka sazebníku se nemaže, jen archivuje — visí na ní zapsaná historie
 * a cizí klíč offence_record.offence_type_id je RESTRICT.
 *
 * Sazebník spravuje **pínař**, ne admin. Je to peněžní agenda a rozhoduje o ní
 * ten, kdo peníze reálně vybírá; admin řeší lidi, role a sezóny.
 *
 * @phpstan-type OffenceType array{
 *     id: int,
 *     seasonId: int,
 *     name: string,
 *     amountCzk: int,
 *     sortOrder: int,
 *     category: string|null,
 *     autoRule: string,
 *     archivedAt: string|null
 * }
 */
final class OffenceTypeService
{
    /** Musí odpovídat ENUM sloupci offence_type.category. */
    public const CATEGORIES = ['discipline', 'performance', 'fun', 'attendance'];

    /** Musí odpovídat ENUM sloupci offence_type.auto_rule. */
    public const AUTO_RULES = ['none', 'unexcused_absence', 'late_arrival'];

    public function __construct(
        private readonly Database $db,
        private readonly TeamScope $scope,
    ) {
    }

    /**
     * Sazebník sezóny. Archivované položky se posílají jen na vyžádání — klient
     * je potřebuje, aby uměl vykreslit i staré zápisy.
     *
     * @return list<OffenceType>
     */
    public function listForSeason(Identity $identity, int $seasonId, bool $includeArchived = false): array
    {
        $this->scope->season($identity, $seasonId, Role::Player);

        $rows = $this->db->all(
            'SELECT id, season_id, name, amount_czk, sort_order, category, auto_rule, archived_at
               FROM offence_type
              WHERE season_id = ?' . ($includeArchived ? '' : ' AND archived_at IS NULL') . '
              ORDER BY sort_order, name',
            [$seasonId],
        );

        return array_map($this->toPayload(...), $rows);
    }

    /**
     * @param  array{name:string,amountCzk:int,sortOrder:int,category:string|null,autoRule:string} $input
     * @return OffenceType
     */
    public function create(Identity $identity, int $seasonId, array $input): array
    {
        $this->scope->writableSeason($identity, $seasonId, Role::Treasurer);

        $this->db->run(
            'INSERT INTO offence_type (season_id, name, amount_czk, sort_order, category, auto_rule)
             VALUES (?, ?, ?, ?, ?, ?)',
            [
                $seasonId,
                $input['name'],
                $input['amountCzk'],
                $input['sortOrder'],
                $input['category'],
                $input['autoRule'],
            ],
        );

        return $this->find($this->db->lastInsertId());
    }

    /**
     * Změna sazebníku se nikdy nepromítne do už zapsaných prohřešků — ty nesou
     * vlastní snapshot ceny (viz OffenceService).
     *
     * @param  array{name?:string,amountCzk?:int,sortOrder?:int,category?:string|null,autoRule?:string,archived?:bool} $changes
     * @return OffenceType
     */
    public function update(Identity $identity, int $typeId, array $changes): array
    {
        $this->authorizeType($identity, $typeId, Role::Treasurer);

        /** @var array<string,string> $columns název pole v požadavku => sloupec */
        $columns = [
            'name'       => 'name',
            'amountCzk'  => 'amount_czk',
            'sortOrder'  => 'sort_order',
            'category'   => 'category',
            'autoRule'   => 'auto_rule',
        ];

        $sets   = [];
        $params = [];

        foreach ($columns as $field => $column) {
            if (array_key_exists($field, $changes)) {
                // Název sloupce pochází z literálu výše, nikdy z požadavku.
                $sets[]   = "$column = ?";
                $params[] = $changes[$field];
            }
        }

        if (array_key_exists('archived', $changes)) {
            $sets[]   = 'archived_at = ?';
            $params[] = $changes['archived'] === true ? date('Y-m-d H:i:s') : null;
        }

        if ($sets === []) {
            throw ApiException::validation('Požadavek neobsahuje žádnou změnu.');
        }

        $params[] = $typeId;
        $this->db->run('UPDATE offence_type SET ' . implode(', ', $sets) . ' WHERE id = ?', $params);

        return $this->find($typeId);
    }

    /**
     * Přeuspořádání sazebníku. Pořadí není kosmetika: v tomhle pořadí se položky
     * nabízejí při zápisu, takže si pínař dopředu srovná nahoru to, co zapisuje
     * po každém tréninku.
     *
     * Bere se celý seznam naráz, ne položka po položce — jinak by se při výpadku
     * uprostřed přetahování sazebník rozsypal do nekonzistentního pořadí.
     *
     * @param  list<int>          $orderedIds v pořadí, v jakém se mají zobrazovat
     * @return list<OffenceType>
     */
    public function reorder(Identity $identity, int $seasonId, array $orderedIds): array
    {
        $this->scope->writableSeason($identity, $seasonId, Role::Treasurer);

        $ids = array_values(array_unique($orderedIds));

        if ($ids === []) {
            throw ApiException::validation('Pořadí musí obsahovat alespoň jednu položku.', ['field' => 'offenceTypeIds']);
        }

        // Placeholdery vznikají z počtu prvků, hodnoty jdou parametry.
        $placeholders = implode(',', array_fill(0, count($ids), '?'));

        $found = $this->db->all(
            "SELECT id FROM offence_type WHERE season_id = ? AND id IN ($placeholders)",
            [$seasonId, ...$ids],
        );

        if (count($found) !== count($ids)) {
            throw ApiException::validation(
                'Pořadí obsahuje položku, která do sazebníku téhle sezóny nepatří.',
                ['field' => 'offenceTypeIds'],
            );
        }

        $this->db->transaction(function () use ($ids, $seasonId): void {
            foreach ($ids as $position => $id) {
                $this->db->run(
                    'UPDATE offence_type SET sort_order = ? WHERE id = ? AND season_id = ?',
                    [($position + 1) * 10, $id, $seasonId],
                );
            }
        });

        return $this->listForSeason($identity, $seasonId, includeArchived: true);
    }

    /**
     * Archivace místo smazání: položka zmizí ze sazebníku, ale zapsané prohřešky
     * si dál umí dohledat svůj název.
     *
     * @return OffenceType
     */
    public function archive(Identity $identity, int $typeId): array
    {
        $this->authorizeType($identity, $typeId, Role::Treasurer);

        $this->db->run(
            'UPDATE offence_type SET archived_at = COALESCE(archived_at, NOW()) WHERE id = ?',
            [$typeId],
        );

        return $this->find($typeId);
    }

    /**
     * Převzetí sazebníku z jiné sezóny téhož týmu. Nová sezóna tak nezačíná
     * prázdným ceníkem, který by pínař vyplňoval znovu ručně.
     *
     * Kopírují se jen nearchivované položky. Položka, jejíž název už v cílové
     * sezóně existuje, se přeskočí — opakované spuštění tedy nic nezduplikuje.
     *
     * @param  list<int>      $onlyTypeIds      prázdné = celý sazebník
     * @param  array<int,int> $amountOverrides  id zdrojové položky => nová částka
     * @return array{created: list<OffenceType>, skipped: list<string>}
     */
    public function copyFrom(
        Identity $identity,
        int $targetSeasonId,
        int $sourceSeasonId,
        array $onlyTypeIds = [],
        array $amountOverrides = [],
    ): array {
        if ($targetSeasonId === $sourceSeasonId) {
            throw ApiException::validation('Zdrojová a cílová sezóna nemohou být stejné.');
        }

        $targetTeam = $this->scope->writableSeason($identity, $targetSeasonId, Role::Treasurer);
        $sourceTeam = $this->scope->season($identity, $sourceSeasonId, Role::Treasurer);

        // Sazebník se přebírá jen v rámci jednoho družstva. Cizí sezóna se tváří
        // jako neexistující, ať API neprozradí, která ID existují.
        if ($targetTeam !== $sourceTeam) {
            throw ApiException::notFound();
        }

        $source = $this->db->all(
            'SELECT id, name, amount_czk, sort_order, category, auto_rule
               FROM offence_type
              WHERE season_id = ? AND archived_at IS NULL
              ORDER BY sort_order, name',
            [$sourceSeasonId],
        );

        if ($onlyTypeIds !== []) {
            $wanted = array_flip($onlyTypeIds);
            $source = array_values(array_filter(
                $source,
                static fn (array $row): bool => isset($wanted[(int) $row['id']]),
            ));

            if (count($source) !== count(array_unique($onlyTypeIds))) {
                throw ApiException::validation(
                    'Některé vybrané položky ve zdrojové sezóně neexistují nebo jsou archivované.',
                    ['field' => 'items'],
                );
            }
        }

        /** @var array<string,true> $existing názvy, které v cílové sezóně už jsou */
        $existing = [];
        foreach ($this->db->all('SELECT name FROM offence_type WHERE season_id = ?', [$targetSeasonId]) as $row) {
            $existing[mb_strtolower((string) $row['name'])] = true;
        }

        /** @var list<int> $createdIds */
        $createdIds = [];
        /** @var list<string> $skipped */
        $skipped = [];

        $this->db->transaction(function () use ($source, $existing, $amountOverrides, $targetSeasonId, &$createdIds, &$skipped): void {
            foreach ($source as $row) {
                $name = (string) $row['name'];

                if (isset($existing[mb_strtolower($name)])) {
                    $skipped[] = $name;

                    continue;
                }

                $sourceId = (int) $row['id'];

                $this->db->run(
                    'INSERT INTO offence_type (season_id, name, amount_czk, sort_order, category, auto_rule)
                     VALUES (?, ?, ?, ?, ?, ?)',
                    [
                        $targetSeasonId,
                        $name,
                        $amountOverrides[$sourceId] ?? (int) $row['amount_czk'],
                        (int) $row['sort_order'],
                        $row['category'],
                        $row['auto_rule'],
                    ],
                );

                $createdIds[] = $this->db->lastInsertId();
            }
        });

        return [
            'created' => array_map($this->find(...), $createdIds),
            'skipped' => $skipped,
        ];
    }

    /**
     * Ověří oprávnění nad položkou sazebníku přes sezónu, do které patří —
     * TeamScope pracuje s entitami, které nesou team_id.
     */
    private function authorizeType(Identity $identity, int $typeId, Role $required): int
    {
        $seasonId = $this->db->value('SELECT season_id FROM offence_type WHERE id = ?', [$typeId]);

        if ($seasonId === null) {
            throw ApiException::notFound();
        }

        $this->scope->writableSeason($identity, (int) $seasonId, $required);

        return (int) $seasonId;
    }

    /** @return OffenceType */
    private function find(int $typeId): array
    {
        $row = $this->db->first(
            'SELECT id, season_id, name, amount_czk, sort_order, category, auto_rule, archived_at
               FROM offence_type WHERE id = ?',
            [$typeId],
        );

        if ($row === null) {
            throw ApiException::notFound();
        }

        return $this->toPayload($row);
    }

    /**
     * @param  array<string,mixed> $row
     * @return OffenceType
     */
    private function toPayload(array $row): array
    {
        return [
            'id'         => (int) $row['id'],
            'seasonId'   => (int) $row['season_id'],
            'name'       => (string) $row['name'],
            'amountCzk'  => (int) $row['amount_czk'],
            'sortOrder'  => (int) $row['sort_order'],
            'category'   => $row['category'] === null ? null : (string) $row['category'],
            'autoRule'   => (string) $row['auto_rule'],
            'archivedAt' => $row['archived_at'] === null ? null : (string) $row['archived_at'],
        ];
    }
}
