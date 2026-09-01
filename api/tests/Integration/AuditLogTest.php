<?php

declare(strict_types=1);

namespace Pina\Tests\Integration;

use Pina\Auth\Identity;
use Pina\Auth\Role;
use Pina\Auth\TeamScope;
use Pina\Auth\TokenService;
use Pina\Http\ApiException;
use Pina\Mail\InvitationMail;
use Pina\Service\AuditLog;
use Pina\Service\FinanceService;
use Pina\Service\OffenceService;
use Pina\Service\OffenceTypeService;
use Pina\Service\SeasonService;
use Pina\Service\TeamService;
use Pina\Tests\Support\FakeMailer;
use RuntimeException;

final class AuditLogTest extends DatabaseTestCase
{
    private AuditLog $audit;
    private TeamScope $scope;
    private int $team;
    private int $foreignTeam;
    private int $season;
    private int $member;
    private Identity $admin;
    private Identity $treasurer;
    private Identity $player;

    protected function setUp(): void
    {
        parent::setUp();

        $this->scope = new TeamScope($this->db);
        $this->audit = new AuditLog($this->db, $this->scope);

        [, $this->team]        = $this->makeTeam('audit', 'Muži A');
        [, $this->foreignTeam] = $this->makeTeam('foreign-audit', 'Junioři');
        $this->season          = $this->makeSeason($this->team, '2026/27');

        $this->admin     = $this->identity('admin@audit.cz', 'Admin', $this->team, Role::Admin);
        $this->treasurer = $this->identity('pinar@audit.cz', 'Pínař', $this->team, Role::Treasurer);
        $this->player    = $this->identity('hrac@audit.cz', 'Hráč', $this->team, Role::Player);

        $memberId     = $this->makeUser('clen@audit.cz');
        $this->member = $this->makeMembership($memberId, $this->team, 'player');
        $this->makeRoster($this->season, [$this->member]);
    }

    public function testRecordIsRolledBackWithDomainTransaction(): void
    {
        try {
            $this->db->transaction(function (): void {
                $this->audit->record($this->admin, $this->team, 'changed', 'test', 1, ['old' => 1, 'new' => 2]);

                throw new RuntimeException('Vynucený rollback.');
            });
        } catch (RuntimeException) {
            // Testuje se výsledek rollbacku, ne samotná výjimka.
        }

        self::assertSame(0, (int) $this->db->value('SELECT COUNT(*) FROM audit_log'));
    }

    public function testAdminReadsOnlyOwnTeamWithPaginationAndResolvedNames(): void
    {
        $this->audit->record($this->admin, $this->team, 'role_changed', 'membership', $this->member, [
            'oldRole' => 'player',
            'newRole' => 'treasurer',
        ]);
        $secondId = $this->audit->record($this->admin, $this->team, 'status_changed', 'membership', $this->member, [
            'oldStatus' => 'active',
            'newStatus' => 'left',
        ]);

        $firstPage = $this->audit->forTeam($this->admin, $this->team, 1, 0);
        self::assertSame($secondId, $firstPage['items'][0]['id']);
        self::assertSame('Admin', $firstPage['items'][0]['actor']['name'] ?? null);
        self::assertSame('clen', $firstPage['items'][0]['membershipName']);
        self::assertSame(['limit' => 1, 'offset' => 0, 'total' => 2, 'hasMore' => true], $firstPage['pagination']);

        $secondPage = $this->audit->forTeam($this->admin, $this->team, 1, 1);
        self::assertFalse($secondPage['pagination']['hasMore']);
        self::assertSame('role_changed', $secondPage['items'][0]['action']);
    }

    public function testPlayerGetsForbiddenAndForeignTeamLooksMissing(): void
    {
        try {
            $this->audit->forTeam($this->player, $this->team, 25, 0);
            self::fail('Hráč nesmí číst provozní stopu.');
        } catch (ApiException $e) {
            self::assertSame(403, $e->status);
        }

        $foreignAdmin = $this->identity('admin@foreign.cz', 'Cizí admin', $this->foreignTeam, Role::Admin);

        try {
            $this->audit->forTeam($foreignAdmin, $this->team, 25, 0);
            self::fail('Cizí družstvo se nesmí prozradit.');
        } catch (ApiException $e) {
            self::assertSame(404, $e->status);
        }

        $platformId = $this->makeUser('platform@audit.cz');
        $platform   = new Identity($platformId, 'platform@audit.cz', 'Správce platformy', true, []);

        try {
            $this->audit->forTeam($platform, $this->team, 25, 0);
            self::fail('Platformní role sama nesmí otevřít peněžní stopu.');
        } catch (ApiException $e) {
            self::assertSame(404, $e->status);
        }
    }

    public function testAllRequiredSensitiveActionsAreRecordedWithoutPersonalCopies(): void
    {
        $finance  = new FinanceService($this->db, $this->scope, audit: $this->audit);
        $offences = new OffenceService($this->db, $this->scope, audit: $this->audit);
        $types    = new OffenceTypeService($this->db, $this->scope, $this->audit);
        $seasons  = new SeasonService($this->db, $this->scope, $this->audit);
        $teams    = new TeamService(
            $this->db,
            $this->scope,
            new TokenService($this->db),
            new InvitationMail(new FakeMailer(false), 'https://pinaprosek.eu'),
            $this->audit,
        );

        $paymentId = $this->insertPayment(480);
        $finance->voidPayment($this->treasurer, $paymentId, 'Duplicitní zápis');

        $claimId = $this->insertTravelClaim(320);
        $finance->voidTravelClaim($this->treasurer, $claimId);

        $typeId = $types->create($this->treasurer, $this->season, [
            'name'          => 'Pozdní příchod',
            'amountCzk'     => 50,
            'sortOrder'     => 10,
            'category'      => 'discipline',
            'autoRule'      => 'none',
            'autoEventType' => 'any',
        ])['id'];
        $types->update($this->treasurer, $typeId, ['amountCzk' => 80]);

        $batchId = $this->insertBatch();
        $this->insertRecord($typeId, 80, $batchId);
        $this->insertRecord($typeId, -20, $batchId);
        $offences->voidBatch($this->treasurer, $batchId);

        $recordId = $this->insertRecord($typeId, 80, null);
        $offences->voidRecord($this->treasurer, $recordId);

        $teams->saveSettings($this->admin, $this->team, [
            'travelEnabled'              => true,
            'travelRateCzkKm'            => 6.5,
            'travelRoundTrip'            => true,
            'homeLocationId'             => null,
            'attendanceVisibleToPlayers' => false,
            'balancesVisibleToPlayers'   => true,
            'rsvpDeadlineTrainingHours'  => 24,
            'rsvpDeadlineMatchHours'     => 48,
            'bankAccount'                => '19-2000145399/0800',
        ]);
        $teams->activationLink($this->admin, $this->member, sendEmail: false);
        $teams->updateMembership($this->admin, $this->member, [
            'role'   => Role::Treasurer,
            'status' => 'left',
        ]);

        $seasons->update($this->admin, $this->season, ['halfYearOn' => '2027-01-01']);
        $seasons->close($this->admin, $this->season);

        $rows = $this->db->all('SELECT action, entity, payload FROM audit_log ORDER BY id');
        self::assertSame([
            'payment:voided',
            'travel_claim:voided',
            'offence_type:price_changed',
            'offence_batch:voided',
            'offence_record:voided',
            'team_settings:settings_changed',
            'invitation:activation_link_issued',
            'membership:role_changed',
            'membership:status_changed',
            'season:half_year_changed',
            'season:closed',
        ], array_map(static fn (array $row): string => $row['entity'] . ':' . $row['action'], $rows));

        $paymentPayload = json_decode((string) $rows[0]['payload'], true, flags: JSON_THROW_ON_ERROR);
        self::assertEquals([
            'amountCzk'    => 480,
            'reason'       => 'Duplicitní zápis',
            'membershipId' => $this->member,
        ], $paymentPayload);

        $batchPayload = json_decode((string) $rows[3]['payload'], true, flags: JSON_THROW_ON_ERROR);
        self::assertEquals(['recordCount' => 2, 'totalCzk' => 60], $batchPayload);

        $allPayloads = implode(' ', array_column($rows, 'payload'));
        self::assertStringNotContainsString('@audit.cz', $allPayloads);
        self::assertStringNotContainsString('clen', mb_strtolower($allPayloads));

        $page   = $this->audit->forTeam($this->admin, $this->team, 25, 0);
        $record = current(array_filter(
            $page['items'],
            static fn (array $item): bool => $item['entity'] === 'offence_record',
        ));
        self::assertIsArray($record);
        self::assertSame('clen', $record['membershipName']);
        self::assertSame('Pozdní příchod', $record['offenceTypeName']);
    }

    private function identity(string $email, string $name, int $teamId, Role $role): Identity
    {
        $userId = $this->makeUser($email);
        $this->db->run('UPDATE `user` SET display_name = ? WHERE id = ?', [$name, $userId]);
        $this->makeMembership($userId, $teamId, $role->value);

        return new Identity($userId, $email, $name, false, [$teamId => $role]);
    }

    private function insertPayment(int $amountCzk): int
    {
        $this->db->run(
            "INSERT INTO payment (season_id, membership_id, amount_czk, paid_on, method)
             VALUES (?, ?, ?, '2026-10-01', 'cash')",
            [$this->season, $this->member, $amountCzk],
        );

        return $this->db->lastInsertId();
    }

    private function insertTravelClaim(int $amountCzk): int
    {
        $this->db->run(
            "INSERT INTO travel_claim
                 (season_id, membership_id, occurred_on, distance_km, rate_czk_km, amount_czk)
             VALUES (?, ?, '2026-10-02', 64, 5, ?)",
            [$this->season, $this->member, $amountCzk],
        );

        return $this->db->lastInsertId();
    }

    private function insertBatch(): int
    {
        $this->db->run(
            "INSERT INTO offence_batch (season_id, occurred_on, client_uuid, created_by)
             VALUES (?, '2026-10-03', '11111111-1111-4111-8111-111111111111', ?)",
            [$this->season, $this->treasurer->userId],
        );

        return $this->db->lastInsertId();
    }

    private function insertRecord(int $typeId, int $amountCzk, ?int $batchId): int
    {
        $this->db->run(
            "INSERT INTO offence_record
                 (season_id, membership_id, offence_type_id, batch_id, amount_czk, occurred_on, created_by)
             VALUES (?, ?, ?, ?, ?, '2026-10-03', ?)",
            [$this->season, $this->member, $typeId, $batchId, $amountCzk, $this->treasurer->userId],
        );

        return $this->db->lastInsertId();
    }
}
