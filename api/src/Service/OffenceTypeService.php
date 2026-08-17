<?php

declare(strict_types=1);

namespace Pina\Service;

use Pina\Auth\Identity;
use Pina\Auth\Role;
use Pina\Auth\TeamScope;
use Pina\Http\ApiException;
use Pina\Support\Database;

/**
 * Per sezóna. amount_czk se znaménkem (bonusy jsou záporné).
 * Archivace místo smazání. Spravuje pínař, ne admin.
 *
 * @phpstan-type OffenceType array{
 *     id: int,
 *     seasonId: int,
 *     name: string,
 *     amountCzk: int,
 *     sortOrder: int,
 *     category: string|null,
 *     autoRule: string,
 *     autoEventType: string,
 *     archivedAt: string|null
 * }
 */
final class OffenceTypeService
{
    /** Musí odpovídat ENUM sloupci offence_type.category. */
    public const CATEGORIES = ['discipline', 'performance', 'fun', 'attendance'];

    /**
     * Co aplikace navrhne sama z docházky. Omluvenou a neomluvenou absenci
     * rozlišuje odpověď hráče předem — kdo řekl „nepřijdu", je omluvený.
     * `late_arrival` zůstává jen pro úplnost: čas příchodu nikdo nezapisuje,
     * takže se pozdní příchod navrhnout nedá.
     */
    public const AUTO_RULES = ['none', 'excused_absence', 'unexcused_absence', 'late_arrival'];

    /**
     * U kterého druhu akce pravidlo platí. Každé družstvo má jinou sazbu za
     * trénink a za zápas, takže bez tohohle rozlišení by návrh strhl částku
     * o stovky vedle.
     */
    public const AUTO_EVENT_TYPES = ['any', 'training', 'match', 'other'];

    public function __construct(
        private readonly Database $db,
        private readonly TeamScope $scope,
    ) {
    }

    /**
     * Archivované jen na vyžádání — pro vykreslení starých záznamů.
     *
     * @return list<OffenceType>
     */
    public function listForSeason(Identity $identity, int $seasonId, bool $includeArchived = false): array
    {
        $this->scope->season($identity, $seasonId, Role::Player);

        $rows = $this->db->all(
            'SELECT id, season_id, name, amount_czk, sort_order, category, auto_rule, auto_event_type, archived_at
               FROM offence_type
              WHERE season_id = ?' . ($includeArchived ? '' : ' AND archived_at IS NULL') . '
              ORDER BY sort_order, name',
            [$seasonId],
        );

        return array_map($this->toPayload(...), $rows);
    }

    /**
     * @param  array{
     *     name:string,amountCzk:int,sortOrder:int,category:string|null,
     *     autoRule:string,autoEventType:string
     * } $input
     * @return OffenceType
     */
    public function create(Identity $identity, int $seasonId, array $input): array
    {
        $this->scope->writableSeason($identity, $seasonId, Role::Treasurer);

        $this->db->run(
            'INSERT INTO offence_type
                 (season_id, name, amount_czk, sort_order, category, auto_rule, auto_event_type)
             VALUES (?, ?, ?, ?, ?, ?, ?)',
            [
                $seasonId,
                $input['name'],
                $input['amountCzk'],
                $input['sortOrder'],
                $input['category'],
                $input['autoRule'],
                $input['autoEventType'],
            ],
        );

        return $this->find($this->db->lastInsertId());
    }

    /**
     * Zapsané prohřešky mají snapshot ceny — změní se jen nové zápisy.
     *
     * @param  array{
     *     name?:string,amountCzk?:int,sortOrder?:int,category?:string|null,
     *     autoRule?:string,autoEventType?:string,archived?:bool
     * } $changes
     * @return OffenceType
     */
    public function update(Identity $identity, int $typeId, array $changes): array
    {
        $this->authorizeType($identity, $typeId, Role::Treasurer);

        /** @var array<string,string> $columns název pole v požadavku => sloupec */
        $columns = [
            'name'          => 'name',
            'amountCzk'     => 'amount_czk',
            'sortOrder'     => 'sort_order',
            'category'      => 'category',
            'autoRule'      => 'auto_rule',
            'autoEventType' => 'auto_event_type',
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
     * Atomicita: selháním uprostřed by se sazebník rozsypal.
     *
     * @param  list<int>          $orderedIds
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
     * Archivace místo smazání — zapsané prohřešky si znají jméno.
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
     * Jen nearchivované, bez duplikátů. Lze přepsat částky.
     *
     * @param  list<int>      $onlyTypeIds      prázdné = celý sazebník
     * @param  array<int,int> $amountOverrides  id zdrojové => nová částka
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
            'SELECT id, name, amount_czk, sort_order, category, auto_rule, auto_event_type
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
                    'INSERT INTO offence_type
                         (season_id, name, amount_czk, sort_order, category, auto_rule, auto_event_type)
                     VALUES (?, ?, ?, ?, ?, ?, ?)',
                    [
                        $targetSeasonId,
                        $name,
                        $amountOverrides[$sourceId] ?? (int) $row['amount_czk'],
                        (int) $row['sort_order'],
                        $row['category'],
                        $row['auto_rule'],
                        $row['auto_event_type'],
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
     * TeamScope pracuje s team_id; sazebník je vázaný na sezónu.
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
            'SELECT id, season_id, name, amount_czk, sort_order, category, auto_rule, auto_event_type, archived_at
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
            'id'            => (int) $row['id'],
            'seasonId'      => (int) $row['season_id'],
            'name'          => (string) $row['name'],
            'amountCzk'     => (int) $row['amount_czk'],
            'sortOrder'     => (int) $row['sort_order'],
            'category'      => $row['category'] === null ? null : (string) $row['category'],
            'autoRule'      => (string) $row['auto_rule'],
            'autoEventType' => (string) $row['auto_event_type'],
            'archivedAt'    => $row['archived_at'] === null ? null : (string) $row['archived_at'],
        ];
    }
}
