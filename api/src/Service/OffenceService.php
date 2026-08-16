<?php

declare(strict_types=1);

namespace Pina\Service;

use PDOException;
use Pina\Auth\Identity;
use Pina\Auth\Role;
use Pina\Auth\TeamScope;
use Pina\Http\ApiException;
use Pina\Support\Database;

/**
 * Zápis prohřešků — nejpoužívanější část aplikace (viz analýza 7.3).
 *
 * Tři věci, na kterých stojí správnost:
 *
 * 1. **Transakce** — dávka projde celá, nebo vůbec. Půl zapsaného tréninku je
 *    horší než nic, protože se nepozná, co chybí.
 * 2. **Idempotence** přes `client_uuid` — dvojklik ani výpadek sítě nesmí
 *    zapsat peníze dvakrát.
 * 3. **Snapshot ceny** do `offence_record.amount_czk` — pozdější úprava sazebníku
 *    nesmí přepsat historii. Hlavní nedostatek staré verze: tam se dluh počítal
 *    joinem na aktuální ceník, takže zdražení pozdě příchodů zpětně zdražilo
 *    i loňské tréninky.
 *
 * Storno se nikdy nedělá DELETE, jen `voided_at` — smazané peníze se nedají
 * dohledat a v týmu z toho bývá dohadování.
 *
 * @phpstan-type BatchItemPayload array{
 *     offenceTypeId: int, name: string, amountCzk: int,
 *     count: int, voidedCount: int, totalCzk: int
 * }
 * @phpstan-type BatchMemberPayload array{
 *     membershipId: int, userId: int, name: string,
 *     recordCount: int, voidedCount: int, totalCzk: int, balanceCzk: int,
 *     items: list<BatchItemPayload>
 * }
 * @phpstan-type BatchPayload array{
 *     id: int, seasonId: int, eventId: int|null, occurredOn: string,
 *     title: string|null, note: string|null, clientUuid: string,
 *     createdBy: array{id:int,name:string}|null, createdAt: string,
 *     voidedAt: string|null, voidedBy: int|null
 * }
 * @phpstan-type BatchSummary array{
 *     batch: BatchPayload,
 *     totalCzk: int, recordCount: int, voidedRecordCount: int, memberCount: int,
 *     members: list<BatchMemberPayload>
 * }
 * @phpstan-type RecordPayload array{
 *     id: int, seasonId: int, membershipId: int, memberName: string,
 *     offenceTypeId: int, offenceTypeName: string, amountCzk: int,
 *     occurredOn: string, batchId: int|null, eventId: int|null,
 *     note: string|null, createdAt: string, voidedAt: string|null
 * }
 * @phpstan-type BatchInput array{
 *     clientUuid: string, occurredOn: string, eventId: int|null,
 *     title: string|null, note: string|null,
 *     items: list<array{membershipId:int,offenceTypeId:int,count:int,note:string|null,expectedAmountCzk:int|null}>
 * }
 */
final class OffenceService
{
    public function __construct(
        private readonly Database $db,
        private readonly TeamScope $scope,
    ) {
    }

    /**
     * Dávkový zápis. Vrací tentýž souhrn jako detail dávky, aby klient po
     * odeslání nemusel volat další endpoint.
     *
     * @param  BatchInput $input
     * @return BatchSummary
     */
    public function createBatch(Identity $identity, int $seasonId, array $input): array
    {
        $teamId = $this->scope->writableSeason($identity, $seasonId, Role::Treasurer);

        // Idempotence: opakované odeslání téhož uuid vrátí původní dávku a nic nezapíše.
        $existing = $this->findBatchIdByUuid($input['clientUuid'], $seasonId);

        if ($existing !== null) {
            return $this->batchSummary($existing);
        }

        $this->loadMemberships($input['items'], $teamId);
        $types   = $this->loadOffenceTypes($input['items'], $seasonId);
        $eventId = $this->resolveEventId($identity, $input['eventId'], $seasonId);

        $this->assertPricesUnchanged($input['items'], $types);

        try {
            $batchId = $this->db->transaction(
                fn (): int => $this->insertBatch($identity, $seasonId, $eventId, $input, $types),
            );
        } catch (PDOException $e) {
            // Souběh dvou stejných odeslání: unikátní index uq_batch_uuid pustí
            // jen jedno z nich, druhé si přečte výsledek toho prvního.
            if ($e->getCode() === '23000') {
                $raced = $this->findBatchIdByUuid($input['clientUuid'], $seasonId);

                if ($raced !== null) {
                    return $this->batchSummary($raced);
                }
            }

            throw $e;
        }

        return $this->batchSummary($batchId);
    }

    /**
     * Detail dávky s rozpisem po hráčích.
     *
     * @return BatchSummary
     */
    public function showBatch(Identity $identity, int $batchId): array
    {
        $seasonId = $this->batchSeasonId($batchId);
        $this->scope->season($identity, $seasonId, Role::Player);

        return $this->batchSummary($batchId);
    }

    /**
     * Storno celé dávky. Opakované volání nic nezmění — pínař po dvojkliku
     * nemá dostat chybu.
     *
     * @return BatchSummary
     */
    public function voidBatch(Identity $identity, int $batchId): array
    {
        $seasonId = $this->batchSeasonId($batchId);
        $this->scope->writableSeason($identity, $seasonId, Role::Treasurer);

        $userId = $identity->userId;

        $this->db->transaction(function () use ($batchId, $userId): void {
            $this->db->run(
                'UPDATE offence_record
                    SET voided_at = NOW(), voided_by = ?
                  WHERE batch_id = ? AND voided_at IS NULL',
                [$userId, $batchId],
            );

            $this->db->run(
                'UPDATE offence_batch
                    SET voided_at = COALESCE(voided_at, NOW()),
                        voided_by = COALESCE(voided_by, ?)
                  WHERE id = ?',
                [$userId, $batchId],
            );
        });

        return $this->batchSummary($batchId);
    }

    /**
     * Storno jednoho zápisu — pínař překlikl hráče nebo prohřešek.
     *
     * @return array{record: RecordPayload, balanceCzk: int}
     */
    public function voidRecord(Identity $identity, int $recordId): array
    {
        $row = $this->db->first(
            'SELECT season_id, membership_id FROM offence_record WHERE id = ?',
            [$recordId],
        );

        if ($row === null) {
            throw ApiException::notFound();
        }

        $seasonId = (int) $row['season_id'];
        $this->scope->writableSeason($identity, $seasonId, Role::Treasurer);

        $this->db->run(
            'UPDATE offence_record SET voided_at = NOW(), voided_by = ? WHERE id = ? AND voided_at IS NULL',
            [$identity->userId, $recordId],
        );

        $membershipId = (int) $row['membership_id'];

        return [
            'record'     => $this->recordDetail($recordId),
            'balanceCzk' => $this->balanceOf($seasonId, $membershipId),
        ];
    }

    /**
     * Seznam zápisů sezóny. Filtry jsou volitelné a kombinovatelné.
     *
     * @return array{items: list<RecordPayload>, count: int, totalCzk: int}
     */
    public function listRecords(
        Identity $identity,
        int $seasonId,
        ?int $membershipId = null,
        ?string $from = null,
        ?string $to = null,
        bool $includeVoided = false,
        int $limit = 200,
        int $offset = 0,
    ): array {
        $teamId = $this->scope->season($identity, $seasonId, Role::Player);

        $where  = ['r.season_id = ?'];
        $params = [$seasonId];

        if ($membershipId !== null) {
            // Kontrola přes TeamScope: cizí členství se tváří jako neexistující.
            if ($this->scope->membership($identity, $membershipId, Role::Player) !== $teamId) {
                throw ApiException::notFound();
            }

            $where[]  = 'r.membership_id = ?';
            $params[] = $membershipId;
        }

        if ($from !== null) {
            $where[]  = 'r.occurred_on >= ?';
            $params[] = $from;
        }

        if ($to !== null) {
            $where[]  = 'r.occurred_on <= ?';
            $params[] = $to;
        }

        if (!$includeVoided) {
            $where[] = 'r.voided_at IS NULL';
        }

        // Podmínky i LIMIT jsou skládané z literálů; hodnoty jdou parametry.
        $sql = $this->recordSelect() . ' WHERE ' . implode(' AND ', $where)
             . ' ORDER BY r.occurred_on DESC, r.id DESC LIMIT ? OFFSET ?';

        $rows  = $this->db->all($sql, [...$params, $limit, $offset]);
        $items = array_map($this->recordPayload(...), $rows);

        $total = 0;
        foreach ($items as $item) {
            if ($item['voidedAt'] === null) {
                $total += $item['amountCzk'];
            }
        }

        return ['items' => $items, 'count' => count($items), 'totalCzk' => $total];
    }

    /**
     * Kdo kolik dluží. Součet je se znaménkem, takže bonusy dluh snižují
     * a hráč se může dostat i do plusu (tým dluží jemu).
     *
     * Zdrojem je **soupiska sezóny**, ne seznam členů družstva. Členství se
     * nemaže kvůli historii, takže u juniorů má tým 48 členů, ale v sezóně
     * 25/26 hrálo 21 lidí — vypsat všechny by dělalo přehled nečitelným.
     *
     * Kdo na soupisce není, ale v té sezóně má zápis, se ukáže taky: odchod
     * z týmu dluh nemaže. Takový řádek nese `onRoster: false`, aby ho UI umělo
     * odlišit.
     *
     * @return array{seasonId:int, totalCzk:int, members: list<array{
     *     membershipId:int, userId:int, name:string, jerseyNumber:int|null,
     *     status:string, onRoster:bool, recordCount:int, balanceCzk:int
     * }>}
     */
    public function balances(Identity $identity, int $seasonId): array
    {
        $teamId = $this->scope->season($identity, $seasonId, Role::Player);

        $rows = $this->db->all(
            'SELECT m.id AS membership_id, m.user_id, m.jersey_number, m.status, u.display_name,
                    re.membership_id IS NOT NULL AS on_roster,
                    COALESCE(SUM(CASE WHEN r.voided_at IS NULL THEN r.amount_czk END), 0) AS balance_czk,
                    -- Podmínka na r.id tu být musí: u hráče bez zápisu doplní LEFT JOIN
                    -- prázdný řádek, ve kterém `voided_at IS NULL` platí, a počet by
                    -- vyšel 1 místo 0.
                    SUM(CASE WHEN r.id IS NOT NULL AND r.voided_at IS NULL THEN 1 ELSE 0 END) AS record_count
               FROM membership m
               JOIN `user` u ON u.id = m.user_id
               LEFT JOIN roster_entry re
                      ON re.membership_id = m.id AND re.season_id = ? AND re.active = 1
               LEFT JOIN offence_record r ON r.membership_id = m.id AND r.season_id = ?
              WHERE m.team_id = ? AND (re.membership_id IS NOT NULL OR r.id IS NOT NULL)
              GROUP BY m.id, m.user_id, m.jersey_number, m.status, u.display_name, re.membership_id
              ORDER BY u.display_name',
            [$seasonId, $seasonId, $teamId],
        );

        $members = [];
        $total   = 0;

        foreach ($rows as $row) {
            $balance = (int) $row['balance_czk'];
            $total  += $balance;

            $members[] = [
                'membershipId' => (int) $row['membership_id'],
                'userId'       => (int) $row['user_id'],
                'name'         => (string) $row['display_name'],
                'jerseyNumber' => $row['jersey_number'] === null ? null : (int) $row['jersey_number'],
                'status'       => (string) $row['status'],
                'onRoster'     => (bool) $row['on_roster'],
                'recordCount'  => (int) $row['record_count'],
                'balanceCzk'   => $balance,
            ];
        }

        return ['seasonId' => $seasonId, 'totalCzk' => $total, 'members' => $members];
    }

    // ----------------------------------------------------------------- zápis

    /**
     * @param  BatchInput                                  $input
     * @param  array<int,array{name:string,amountCzk:int}> $types
     * @return int                                         id založené dávky
     */
    private function insertBatch(Identity $identity, int $seasonId, ?int $eventId, array $input, array $types): int
    {
        $this->db->run(
            'INSERT INTO offence_batch (season_id, event_id, occurred_on, title, note, client_uuid, created_by)
             VALUES (?, ?, ?, ?, ?, ?, ?)',
            [
                $seasonId,
                $eventId,
                $input['occurredOn'],
                $input['title'],
                $input['note'],
                $input['clientUuid'],
                $identity->userId,
            ],
        );

        $batchId = $this->db->lastInsertId();

        $placeholders = [];
        $params       = [];

        foreach ($input['items'] as $item) {
            // count = N znamená N samostatných řádků: „třikrát pozdní příchod"
            // se pak dá stornovat po jednom.
            for ($i = 0; $i < $item['count']; $i++) {
                $placeholders[] = '(?, ?, ?, ?, ?, ?, ?, ?, ?)';
                $params[]       = $seasonId;
                $params[]       = $item['membershipId'];
                $params[]       = $item['offenceTypeId'];
                $params[]       = $batchId;
                $params[]       = $eventId;
                $params[]       = $types[$item['offenceTypeId']]['amountCzk']; // snapshot ceny
                $params[]       = $input['occurredOn'];
                $params[]       = $item['note'];
                $params[]       = $identity->userId;
            }
        }

        // Placeholdery vznikají opakováním literálu výše, ne z dat požadavku.
        $this->db->run(
            'INSERT INTO offence_record
                 (season_id, membership_id, offence_type_id, batch_id, event_id,
                  amount_czk, occurred_on, note, created_by)
             VALUES ' . implode(', ', $placeholders),
            $params,
        );

        return $batchId;
    }

    // ------------------------------------------------------------- validace

    /**
     * Všechna členství musí patřit do týmu té sezóny. Bez téhle kontroly by
     * pínař mohl zapsat prohřešek hráči cizího klubu.
     *
     * @param  list<array{membershipId:int,offenceTypeId:int,count:int,note:string|null,expectedAmountCzk:int|null}> $items
     * @return array<int,array{userId:int,name:string}>
     */
    private function loadMemberships(array $items, int $teamId): array
    {
        $ids = $this->uniqueIds($items, 'membershipId');

        $rows = $this->db->all(
            'SELECT m.id, m.user_id, u.display_name
               FROM membership m
               JOIN `user` u ON u.id = m.user_id
              WHERE m.team_id = ? AND m.id IN (' . $this->placeholders(count($ids)) . ')',
            [$teamId, ...$ids],
        );

        $found = [];
        foreach ($rows as $row) {
            $found[(int) $row['id']] = [
                'userId' => (int) $row['user_id'],
                'name'   => (string) $row['display_name'],
            ];
        }

        $missing = array_values(array_diff($ids, array_keys($found)));

        if ($missing !== []) {
            throw ApiException::validation(
                'Někteří hráči nepatří do týmu této sezóny.',
                ['field' => 'items', 'membershipIds' => $missing],
            );
        }

        return $found;
    }

    /**
     * Prohřešky musí být ze sazebníku téže sezóny a nesmí být archivované —
     * do archivu se položka dává právě proto, aby se už nezapisovala.
     *
     * @param  list<array{membershipId:int,offenceTypeId:int,count:int,note:string|null,expectedAmountCzk:int|null}> $items
     * @return array<int,array{name:string,amountCzk:int}>
     */
    private function loadOffenceTypes(array $items, int $seasonId): array
    {
        $ids = $this->uniqueIds($items, 'offenceTypeId');

        $rows = $this->db->all(
            'SELECT id, name, amount_czk, archived_at
               FROM offence_type
              WHERE season_id = ? AND id IN (' . $this->placeholders(count($ids)) . ')',
            [$seasonId, ...$ids],
        );

        $found    = [];
        $archived = [];

        foreach ($rows as $row) {
            if ($row['archived_at'] !== null) {
                $archived[] = (int) $row['id'];

                continue;
            }

            $found[(int) $row['id']] = [
                'name'      => (string) $row['name'],
                'amountCzk' => (int) $row['amount_czk'],
            ];
        }

        if ($archived !== []) {
            throw ApiException::validation(
                'Archivovaný prohřešek už nelze zapisovat.',
                ['field' => 'items', 'offenceTypeIds' => $archived],
            );
        }

        $missing = array_values(array_diff($ids, array_keys($found)));

        if ($missing !== []) {
            throw ApiException::validation(
                'Některé prohřešky nejsou v sazebníku této sezóny.',
                ['field' => 'items', 'offenceTypeIds' => $missing],
            );
        }

        return $found;
    }

    /**
     * Klient smí poslat cenu, kterou zobrazil v souhrnu. Když se mezitím změnil
     * sazebník, vrátí se 409 s rozdílem a klient souhrn přepočítá (analýza 7.3).
     *
     * @param list<array{membershipId:int,offenceTypeId:int,count:int,note:string|null,expectedAmountCzk:int|null}> $items
     * @param array<int,array{name:string,amountCzk:int}>                                                          $types
     */
    private function assertPricesUnchanged(array $items, array $types): void
    {
        $changed = [];

        foreach ($items as $item) {
            $expected = $item['expectedAmountCzk'];
            $actual   = $types[$item['offenceTypeId']]['amountCzk'];

            if ($expected !== null && $expected !== $actual) {
                $changed[$item['offenceTypeId']] = [
                    'offenceTypeId' => $item['offenceTypeId'],
                    'name'          => $types[$item['offenceTypeId']]['name'],
                    'expectedCzk'   => $expected,
                    'currentCzk'    => $actual,
                ];
            }
        }

        if ($changed !== []) {
            throw ApiException::conflict(
                'PRICE_CHANGED',
                'Sazebník se mezitím změnil, zkontrolujte souhrn.',
                ['changes' => array_values($changed)],
            );
        }
    }

    /** Akce je nepovinná; když přijde, musí patřit do téže sezóny. */
    private function resolveEventId(Identity $identity, ?int $eventId, int $seasonId): ?int
    {
        if ($eventId === null) {
            return null;
        }

        $this->scope->event($identity, $eventId, Role::Treasurer);

        $eventSeason = $this->db->value('SELECT season_id FROM event WHERE id = ?', [$eventId]);

        if ($eventSeason === null || (int) $eventSeason !== $seasonId) {
            throw ApiException::validation(
                'Akce nepatří do této sezóny.',
                ['field' => 'eventId', 'eventId' => $eventId],
            );
        }

        return $eventId;
    }

    // -------------------------------------------------------------- čtení

    /** @return BatchSummary */
    private function batchSummary(int $batchId): array
    {
        $batch = $this->db->first(
            'SELECT b.id, b.season_id, b.event_id, b.occurred_on, b.title, b.note, b.client_uuid,
                    b.created_by, b.created_at, b.voided_at, b.voided_by, u.display_name AS created_by_name
               FROM offence_batch b
               LEFT JOIN `user` u ON u.id = b.created_by
              WHERE b.id = ?',
            [$batchId],
        );

        if ($batch === null) {
            throw ApiException::notFound();
        }

        $seasonId = (int) $batch['season_id'];

        // Seskupení po hráči a prohřešku — přesně to, co pínař vidí v souhrnu.
        // Do klíče patří i amount_czk: kdyby se v jedné dávce sešly dvě ceny
        // téhož prohřešku, nesmí se slít do jednoho řádku.
        $rows = $this->db->all(
            'SELECT r.membership_id, r.offence_type_id, r.amount_czk,
                    t.name AS type_name, t.sort_order,
                    m.user_id, u.display_name,
                    COUNT(*) AS record_count,
                    SUM(CASE WHEN r.voided_at IS NOT NULL THEN 1 ELSE 0 END) AS voided_count
               FROM offence_record r
               JOIN offence_type t ON t.id = r.offence_type_id
               JOIN membership m ON m.id = r.membership_id
               JOIN `user` u ON u.id = m.user_id
              WHERE r.batch_id = ?
              GROUP BY r.membership_id, r.offence_type_id, r.amount_czk,
                       t.name, t.sort_order, m.user_id, u.display_name
              ORDER BY u.display_name, t.sort_order, t.name',
            [$batchId],
        );

        /** @var array<int,array{membershipId:int,userId:int,name:string,recordCount:int,voidedCount:int,totalCzk:int,balanceCzk:int,items:list<array{offenceTypeId:int,name:string,amountCzk:int,count:int,voidedCount:int,totalCzk:int}>}> $members */
        $members         = [];
        $total           = 0;
        $activeRecords   = 0;
        $voidedRecords   = 0;

        foreach ($rows as $row) {
            $membershipId = (int) $row['membership_id'];
            $count        = (int) $row['record_count'];
            $voided       = (int) $row['voided_count'];
            $amount       = (int) $row['amount_czk'];
            $itemTotal    = $amount * ($count - $voided);

            $members[$membershipId] ??= [
                'membershipId' => $membershipId,
                'userId'       => (int) $row['user_id'],
                'name'         => (string) $row['display_name'],
                'recordCount'  => 0,
                'voidedCount'  => 0,
                'totalCzk'     => 0,
                'balanceCzk'   => 0,
                'items'        => [],
            ];

            $members[$membershipId]['recordCount'] += $count - $voided;
            $members[$membershipId]['voidedCount'] += $voided;
            $members[$membershipId]['totalCzk']    += $itemTotal;
            $members[$membershipId]['items'][]      = [
                'offenceTypeId' => (int) $row['offence_type_id'],
                'name'          => (string) $row['type_name'],
                'amountCzk'     => $amount,
                'count'         => $count,
                'voidedCount'   => $voided,
                // Stornované řádky se do částky nepočítají.
                'totalCzk'      => $itemTotal,
            ];

            $total         += $itemTotal;
            $activeRecords += $count - $voided;
            $voidedRecords += $voided;
        }

        // Nový dluh hráče po zápisu — pínař hned vidí, komu se to vyšplhalo.
        $balances = $this->balancesOf($seasonId, array_keys($members));

        foreach ($members as $membershipId => $_) {
            $members[$membershipId]['balanceCzk'] = $balances[$membershipId] ?? 0;
        }

        return [
            'batch' => [
                'id'         => (int) $batch['id'],
                'seasonId'   => $seasonId,
                'eventId'    => $batch['event_id'] === null ? null : (int) $batch['event_id'],
                'occurredOn' => (string) $batch['occurred_on'],
                'title'      => $batch['title'] === null ? null : (string) $batch['title'],
                'note'       => $batch['note'] === null ? null : (string) $batch['note'],
                'clientUuid' => (string) $batch['client_uuid'],
                'createdBy'  => $batch['created_by'] === null ? null : [
                    'id'   => (int) $batch['created_by'],
                    'name' => (string) $batch['created_by_name'],
                ],
                'createdAt'  => (string) $batch['created_at'],
                'voidedAt'   => $batch['voided_at'] === null ? null : (string) $batch['voided_at'],
                'voidedBy'   => $batch['voided_by'] === null ? null : (int) $batch['voided_by'],
            ],
            'totalCzk'          => $total,
            'recordCount'       => $activeRecords,
            'voidedRecordCount' => $voidedRecords,
            'memberCount'       => count($members),
            'members'           => array_values($members),
        ];
    }

    /** @return RecordPayload */
    private function recordDetail(int $recordId): array
    {
        $row = $this->db->first($this->recordSelect() . ' WHERE r.id = ?', [$recordId]);

        if ($row === null) {
            throw ApiException::notFound();
        }

        return $this->recordPayload($row);
    }

    private function recordSelect(): string
    {
        return 'SELECT r.id, r.season_id, r.membership_id, r.offence_type_id, r.amount_czk,
                       r.occurred_on, r.batch_id, r.event_id, r.note, r.created_at, r.voided_at,
                       t.name AS type_name, u.display_name
                  FROM offence_record r
                  JOIN offence_type t ON t.id = r.offence_type_id
                  JOIN membership m ON m.id = r.membership_id
                  JOIN `user` u ON u.id = m.user_id';
    }

    /**
     * @param  array<string,mixed> $row
     * @return RecordPayload
     */
    private function recordPayload(array $row): array
    {
        return [
            'id'              => (int) $row['id'],
            'seasonId'        => (int) $row['season_id'],
            'membershipId'    => (int) $row['membership_id'],
            'memberName'      => (string) $row['display_name'],
            'offenceTypeId'   => (int) $row['offence_type_id'],
            'offenceTypeName' => (string) $row['type_name'],
            'amountCzk'       => (int) $row['amount_czk'],
            'occurredOn'      => (string) $row['occurred_on'],
            'batchId'         => $row['batch_id'] === null ? null : (int) $row['batch_id'],
            'eventId'         => $row['event_id'] === null ? null : (int) $row['event_id'],
            'note'            => $row['note'] === null ? null : (string) $row['note'],
            'createdAt'       => (string) $row['created_at'],
            'voidedAt'        => $row['voided_at'] === null ? null : (string) $row['voided_at'],
        ];
    }

    /** Dluh hráče = součet nestornovaných zápisů, včetně záporných bonusů. */
    private function balanceOf(int $seasonId, int $membershipId): int
    {
        return $this->balancesOf($seasonId, [$membershipId])[$membershipId] ?? 0;
    }

    /**
     * @param  list<int>       $membershipIds
     * @return array<int,int>  membership_id => dluh
     */
    private function balancesOf(int $seasonId, array $membershipIds): array
    {
        if ($membershipIds === []) {
            return [];
        }

        $rows = $this->db->all(
            'SELECT membership_id, SUM(amount_czk) AS balance_czk
               FROM offence_record
              WHERE season_id = ? AND voided_at IS NULL
                AND membership_id IN (' . $this->placeholders(count($membershipIds)) . ')
              GROUP BY membership_id',
            [$seasonId, ...$membershipIds],
        );

        $balances = [];
        foreach ($rows as $row) {
            $balances[(int) $row['membership_id']] = (int) $row['balance_czk'];
        }

        foreach ($membershipIds as $id) {
            $balances[$id] ??= 0;
        }

        return $balances;
    }

    private function batchSeasonId(int $batchId): int
    {
        $seasonId = $this->db->value('SELECT season_id FROM offence_batch WHERE id = ?', [$batchId]);

        if ($seasonId === null) {
            throw ApiException::notFound();
        }

        return (int) $seasonId;
    }

    /** Dávka se stejným uuid v jiné sezóně by znamenala chybu na straně klienta. */
    private function findBatchIdByUuid(string $clientUuid, int $seasonId): ?int
    {
        $row = $this->db->first(
            'SELECT id, season_id FROM offence_batch WHERE client_uuid = ?',
            [$clientUuid],
        );

        if ($row === null) {
            return null;
        }

        if ((int) $row['season_id'] !== $seasonId) {
            throw ApiException::conflict(
                'CLIENT_UUID_CONFLICT',
                'Dávka s tímto identifikátorem už existuje v jiné sezóně.',
                ['clientUuid' => $clientUuid],
            );
        }

        return (int) $row['id'];
    }

    /**
     * @param  list<array{membershipId:int,offenceTypeId:int,count:int,note:string|null,expectedAmountCzk:int|null}> $items
     * @param  'membershipId'|'offenceTypeId'                                                                       $key
     * @return list<int>
     */
    private function uniqueIds(array $items, string $key): array
    {
        $ids = [];
        foreach ($items as $item) {
            $ids[$item[$key]] = true;
        }

        return array_keys($ids);
    }

    /** Placeholdery pro IN (...) — počet vychází z velikosti pole, ne z jeho obsahu. */
    private function placeholders(int $count): string
    {
        return implode(', ', array_fill(0, $count, '?'));
    }
}
