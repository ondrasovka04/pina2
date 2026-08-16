<?php

declare(strict_types=1);

namespace Pina\Service;

use Pina\Auth\Identity;
use Pina\Auth\Role;
use Pina\Auth\TeamScope;
use Pina\Auth\TokenService;
use Pina\Http\ApiException;
use Pina\Support\Database;
use Pina\Support\PaymentReference;

/**
 * Družstva, jejich členové a nastavení.
 *
 * Každá metoda si přístup ověřuje přes TeamScope — role se nikde nečte z tokenu,
 * ale z databáze, takže odebrané oprávnění platí okamžitě.
 *
 * @phpstan-type TeamSettings array{
 *     travelEnabled:bool,
 *     travelRateCzkKm:float,
 *     travelRoundTrip:bool,
 *     settlementPeriod:string,
 *     homeLocationId:int|null,
 *     attendanceVisibleToPlayers:bool,
 *     balancesVisibleToPlayers:bool
 * }
 * @phpstan-type TeamDetail array{
 *     id:int,
 *     name:string,
 *     color:string|null,
 *     archivedAt:string|null,
 *     clubId:int,
 *     clubName:string,
 *     memberCount:int,
 *     settings:TeamSettings
 * }
 * @phpstan-type TeamMember array{
 *     id:int,
 *     userId:int,
 *     name:string,
 *     email:string,
 *     role:string,
 *     status:string,
 *     jerseyNumber:int|null,
 *     paymentReference:string,
 *     joinedAt:string,
 *     hasPassword:bool
 * }
 */
final class TeamService
{
    /** Pozvánka platí tři dny — dost na to, aby si ji hráč všiml, a přitom krátce. */
    private const INVITATION_TTL_HOURS = 72;

    /** @var list<string> */
    private const MEMBER_STATUSES = ['active', 'suspended', 'left'];

    /** @var list<string> */
    private const SETTLEMENT_PERIODS = ['none', 'half_year', 'season'];

    public function __construct(
        private readonly Database $db,
        private readonly TeamScope $scope,
        private readonly TokenService $tokens,
    ) {
    }

    /**
     * Družstva přihlášeného. Výběr je omezený jeho členstvími, proto se tu
     * TeamScope nepoužívá — není co ověřovat, cizí řádek se do výsledku nedostane.
     *
     * @return list<array{
     *     id:int,
     *     name:string,
     *     color:string|null,
     *     clubId:int,
     *     clubName:string,
     *     membershipId:int,
     *     role:string,
     *     archived:bool,
     *     currentSeason:array{id:int,name:string}|null
     * }>
     */
    public function myTeams(Identity $identity): array
    {
        $rows = $this->db->all(
            "SELECT t.id, t.name, t.color, t.archived_at,
                    c.id AS club_id, c.name AS club_name,
                    m.id AS membership_id, m.role,
                    s.id AS season_id, s.name AS season_name
               FROM membership m
               JOIN team t ON t.id = m.team_id
               JOIN club c ON c.id = t.club_id
               LEFT JOIN season s ON s.team_id = t.id AND s.is_current = 1
              WHERE m.user_id = ? AND m.status <> 'left'
              ORDER BY c.name, t.name",
            [$identity->userId],
        );

        return array_map(static fn (array $row): array => [
            'id'            => (int) $row['id'],
            'name'          => (string) $row['name'],
            'color'         => $row['color'] === null ? null : (string) $row['color'],
            'clubId'        => (int) $row['club_id'],
            'clubName'      => (string) $row['club_name'],
            'membershipId'  => (int) $row['membership_id'],
            'role'          => (string) $row['role'],
            'archived'      => $row['archived_at'] !== null,
            'currentSeason' => $row['season_id'] === null ? null : [
                'id'   => (int) $row['season_id'],
                'name' => (string) $row['season_name'],
            ],
        ], $rows);
    }

    /**
     * Založí klub. Smí to jen platformní admin — klub je nejvyšší jednotka
     * a nikdo „nad ním" neexistuje, kdo by zakládání mohl povolit.
     *
     * Zakladatel klubu ještě není ničím členem; členství vzniká až s prvním
     * družstvem, protože role je vázaná na družstvo, ne na klub.
     *
     * @return array{id:int,name:string,slug:string}
     */
    public function createClub(Identity $identity, string $name): array
    {
        if (!$identity->isPlatformAdmin) {
            throw ApiException::forbidden('Nový klub může založit jen správce platformy.');
        }

        $name = trim($name);

        if ($name === '') {
            throw ApiException::validation('Název klubu nesmí být prázdný.', ['field' => 'name']);
        }

        $slug = $this->uniqueClubSlug($name);

        $this->db->run('INSERT INTO club (name, slug) VALUES (?, ?)', [$name, $slug]);

        return ['id' => $this->db->lastInsertId(), 'name' => $name, 'slug' => $slug];
    }

    /**
     * Založí družstvo v existujícím klubu a zakladatele rovnou udělá jeho adminem.
     *
     * Tím se řetěz oprávnění uzavírá sám: admin mužů může založit juniory a je
     * jejich adminem, dokud roli nepředá dál. Žádné pevně zadané ID se na to
     * nepoužívá — rozhoduje jen role v klubu (viz TeamScope::club).
     *
     * @return TeamDetail
     */
    public function createTeam(Identity $identity, int $clubId, string $name, ?string $color): array
    {
        $this->scope->club($identity, $clubId, Role::Admin);

        $name = trim($name);

        if ($name === '') {
            throw ApiException::validation('Název družstva nesmí být prázdný.', ['field' => 'name']);
        }

        $duplicate = $this->db->value(
            'SELECT id FROM team WHERE club_id = ? AND name = ?',
            [$clubId, $name],
        );

        if ($duplicate !== null) {
            throw ApiException::conflict(
                'TEAM_EXISTS',
                'Družstvo s tímto názvem už v klubu je.',
                ['name' => $name],
            );
        }

        $teamId = $this->db->transaction(function () use ($clubId, $name, $color, $identity): int {
            $this->db->run(
                'INSERT INTO team (club_id, name, color) VALUES (?, ?, ?)',
                [$clubId, $name, $color],
            );
            $teamId = $this->db->lastInsertId();

            $this->db->run(
                "INSERT INTO membership (user_id, team_id, role, payment_reference, status)
                 VALUES (?, ?, 'admin', ?, 'active')",
                [$identity->userId, $teamId, PaymentReference::for($teamId, $identity->userId)],
            );

            return $teamId;
        });

        // Zakladatelův token o novém družstvu neví; bez zneplatnění by na něj
        // dalších 15 minut neměl práva.
        $this->tokens->onRoleChanged($identity->userId);

        return $this->teamPayload($teamId);
    }

    /**
     * @return TeamDetail
     */
    public function detail(Identity $identity, int $teamId): array
    {
        $this->scope->team($identity, $teamId, Role::Player);

        return $this->teamPayload($teamId);
    }

    /**
     * @param  array{name?:string,color?:string|null} $changes
     * @return TeamDetail
     */
    public function update(Identity $identity, int $teamId, array $changes): array
    {
        $this->scope->team($identity, $teamId, Role::Admin);

        $sets   = [];
        $params = [];

        if (isset($changes['name'])) {
            $sets[]   = 'name = ?';
            $params[] = $changes['name'];
        }

        if (array_key_exists('color', $changes)) {
            $sets[]   = 'color = ?';
            $params[] = $changes['color'];
        }

        if ($sets === []) {
            throw ApiException::validation('Není co upravit — pošlete alespoň jedno pole.');
        }

        // Do dotazu se skládají jen literály vypsané výše, hodnoty jdou parametrem.
        $params[] = $teamId;
        $this->db->run('UPDATE team SET ' . implode(', ', $sets) . ' WHERE id = ?', $params);

        return $this->teamPayload($teamId);
    }

    /**
     * @return list<TeamMember>
     */
    public function members(Identity $identity, int $teamId): array
    {
        $this->scope->team($identity, $teamId, Role::Player);

        $rows = $this->db->all(
            'SELECT m.id, m.user_id, m.role, m.status, m.jersey_number, m.payment_reference, m.joined_at,
                    u.display_name, u.email, u.password_hash IS NOT NULL AS has_password
               FROM membership m
               JOIN `user` u ON u.id = m.user_id
              WHERE m.team_id = ?
              ORDER BY FIELD(m.status, \'active\', \'suspended\', \'left\'), u.display_name',
            [$teamId],
        );

        return array_map(static fn (array $row): array => [
            'id'               => (int) $row['id'],
            'userId'           => (int) $row['user_id'],
            'name'             => (string) $row['display_name'],
            'email'            => (string) $row['email'],
            'role'             => (string) $row['role'],
            'status'           => (string) $row['status'],
            'jerseyNumber'     => $row['jersey_number'] === null ? null : (int) $row['jersey_number'],
            'paymentReference' => (string) $row['payment_reference'],
            'joinedAt'         => (string) $row['joined_at'],
            // Kdo heslo nemá, ještě se nikdy nepřihlásil — admin mu vyrobí aktivační odkaz.
            'hasPassword'      => (bool) $row['has_password'],
        ], $rows);
    }

    /**
     * Vytvoří pozvánku do týmu.
     *
     * POZOR: e-mail se záměrně NEODESÍLÁ — odesílání pošty je v tomto projektu
     * vypnuté. Token se proto vrací v odpovědi a admin ho pozvanému předá sám
     * (odkaz přes chat, osobně). Z téhož důvodu se token nikam neloguje.
     * V databázi zůstává jen jeho SHA-256 otisk, takže únik tabulky pozvánek
     * sám o sobě nikomu přístup do týmu nedá.
     *
     * @return array{id:int,email:string,role:string,expiresAt:string,token:string}
     */
    public function invite(Identity $identity, int $teamId, string $email, Role $role): array
    {
        $this->scope->team($identity, $teamId, Role::Admin);

        $email = mb_strtolower($email);

        $existing = $this->db->value(
            "SELECT m.id
               FROM membership m
               JOIN `user` u ON u.id = m.user_id
              WHERE m.team_id = ? AND u.email = ? AND m.status <> 'left'",
            [$teamId, $email],
        );

        if ($existing !== null) {
            throw ApiException::conflict(
                'MEMBER_EXISTS',
                'Uživatel s tímto e-mailem už v družstvu je.',
                ['email' => $email],
            );
        }

        $token = bin2hex(random_bytes(32));

        $this->db->run(
            'INSERT INTO invitation (team_id, email, role, token_hash, expires_at, invited_by)
             VALUES (?, ?, ?, ?, DATE_ADD(NOW(), INTERVAL ? HOUR), ?)',
            [
                $teamId,
                $email,
                $role->value,
                hash('sha256', $token),
                self::INVITATION_TTL_HOURS,
                $identity->userId,
            ],
        );

        $id        = $this->db->lastInsertId();
        $expiresAt = (string) $this->db->value('SELECT expires_at FROM invitation WHERE id = ?', [$id]);

        return [
            'id'        => $id,
            'email'     => $email,
            'role'      => $role->value,
            'expiresAt' => $expiresAt,
            'token'     => $token,
        ];
    }

    /**
     * Nevyzvednuté pozvánky. Token se nevrací — v databázi je jen jeho otisk
     * a zpětně ho spočítat nelze. Ztracený odkaz se řeší novou pozvánkou.
     *
     * @return list<array{id:int,email:string,role:string,expiresAt:string,expired:bool,createdAt:string}>
     */
    public function invitations(Identity $identity, int $teamId): array
    {
        $this->scope->team($identity, $teamId, Role::Admin);

        $rows = $this->db->all(
            'SELECT id, email, role, expires_at, created_at, expires_at < NOW() AS expired
               FROM invitation
              WHERE team_id = ? AND accepted_at IS NULL
              ORDER BY created_at DESC',
            [$teamId],
        );

        return array_map(static fn (array $row): array => [
            'id'        => (int) $row['id'],
            'email'     => (string) $row['email'],
            'role'      => (string) $row['role'],
            'expiresAt' => (string) $row['expires_at'],
            'expired'   => (bool) $row['expired'],
            'createdAt' => (string) $row['created_at'],
        ], $rows);
    }

    /** Zruší nevyzvednutou pozvánku — odkaz tím okamžitě přestane platit. */
    public function revokeInvitation(Identity $identity, int $invitationId): void
    {
        $this->scope->invitation($identity, $invitationId, Role::Admin);

        $deleted = $this->db
            ->run('DELETE FROM invitation WHERE id = ? AND accepted_at IS NULL', [$invitationId])
            ->rowCount();

        // Přijatou pozvánku už zrušit nelze; členství z ní vzniklo a ruší se
        // změnou stavu člena, ne mazáním pozvánky.
        if ($deleted === 0) {
            throw ApiException::conflict(
                'INVITATION_ACCEPTED',
                'Pozvánka už byla přijata, zrušit ji nelze.',
                ['invitationId' => $invitationId],
            );
        }
    }

    /**
     * Aktivační odkaz pro člena, který ještě nemá heslo.
     *
     * Migrace ze staré aplikace hesla nepřenesla (byly to SHA-256 otisky bez soli),
     * takže drtivá většina účtů se nemá čím přihlásit. Běžná pozvánka na ně
     * nesedne — ta existující členství odmítá. Odkaz se tvoří jako pozvánka
     * se stávající rolí člena, takže ho `acceptInvitation` zpracuje beze změn.
     *
     * Bezpečnostní pojistka je v `acceptInvitation`: heslo se zapisuje přes
     * COALESCE, takže existující heslo nepřepíše. Odkaz proto nejde zneužít
     * k převzetí cizího účtu — a pro jistotu ho tahle metoda pro účet s heslem
     * ani nevydá.
     *
     * @return array{email:string,role:string,expiresAt:string,token:string}
     */
    public function activationLink(Identity $identity, int $membershipId): array
    {
        $teamId = $this->scope->membership($identity, $membershipId, Role::Admin);

        $member = $this->db->first(
            'SELECT m.role, u.email, u.password_hash
               FROM membership m
               JOIN `user` u ON u.id = m.user_id
              WHERE m.id = ?',
            [$membershipId],
        );

        if ($member === null) {
            throw ApiException::notFound();
        }

        if ($member['password_hash'] !== null) {
            throw ApiException::conflict(
                'PASSWORD_ALREADY_SET',
                'Tento člen už heslo má. Zapomenuté heslo se řeší obnovou, ne aktivací.',
                ['membershipId' => $membershipId],
            );
        }

        $email = (string) $member['email'];

        // Migrace založila zástupné adresy lidem, kteří v staré databázi e-mail
        // neměli. Na takovou adresu se nelze přihlásit, musí se nejdřív opravit.
        if (str_ends_with($email, '@pinaprosek.invalid')) {
            throw ApiException::validation(
                'Člen nemá skutečnou e-mailovou adresu, nejdřív ji doplňte.',
                ['field' => 'email'],
            );
        }

        $token = bin2hex(random_bytes(32));

        $this->db->run(
            'INSERT INTO invitation (team_id, email, role, token_hash, expires_at, invited_by)
             VALUES (?, ?, ?, ?, DATE_ADD(NOW(), INTERVAL ? HOUR), ?)',
            [
                $teamId,
                $email,
                (string) $member['role'],
                hash('sha256', $token),
                self::INVITATION_TTL_HOURS,
                $identity->userId,
            ],
        );

        $expiresAt = (string) $this->db->value(
            'SELECT expires_at FROM invitation WHERE id = ?',
            [$this->db->lastInsertId()],
        );

        return [
            'email'     => $email,
            'role'      => (string) $member['role'],
            'expiresAt' => $expiresAt,
            'token'     => $token,
        ];
    }

    /**
     * @param  array{role?:Role,jerseyNumber?:int|null,status?:string} $changes
     * @return TeamMember
     */
    public function updateMembership(Identity $identity, int $membershipId, array $changes): array
    {
        $this->scope->membership($identity, $membershipId, Role::Admin);

        $current = $this->db->first(
            'SELECT id, user_id, team_id, role, status FROM membership WHERE id = ?',
            [$membershipId],
        );

        if ($current === null) {
            throw ApiException::notFound();
        }

        $this->assertNotLastAdmin($current, $changes);

        $sets   = [];
        $params = [];

        if (isset($changes['role'])) {
            $sets[]   = 'role = ?';
            $params[] = $changes['role']->value;
        }

        if (array_key_exists('jerseyNumber', $changes)) {
            $sets[]   = 'jersey_number = ?';
            $params[] = $changes['jerseyNumber'];
        }

        if (isset($changes['status'])) {
            if (!in_array($changes['status'], self::MEMBER_STATUSES, true)) {
                throw ApiException::validation('Neznámý stav členství.', ['field' => 'status']);
            }

            $sets[]   = 'status = ?';
            $params[] = $changes['status'];
            // Odchod z družstva se datuje, návrat zpět datum ruší.
            $sets[]   = $changes['status'] === 'left' ? 'left_at = NOW()' : 'left_at = NULL';
        }

        if ($sets === []) {
            throw ApiException::validation('Není co upravit — pošlete alespoň jedno pole.');
        }

        // Do dotazu se skládají jen literály vypsané výše, hodnoty jdou parametrem.
        $params[] = $membershipId;
        $this->db->run('UPDATE membership SET ' . implode(', ', $sets) . ' WHERE id = ?', $params);

        $roleChanged   = isset($changes['role']) && $changes['role']->value !== (string) $current['role'];
        $statusChanged = isset($changes['status']) && $changes['status'] !== (string) $current['status'];

        // Oprávnění nese vydaný JWT, který platí ještě 15 minut. Odebranou roli
        // (i pozastavené členství) je proto nutné promítnout do už vydaných tokenů.
        if ($roleChanged || $statusChanged) {
            $this->tokens->onRoleChanged((int) $current['user_id']);
        }

        return $this->memberPayload($membershipId);
    }

    /**
     * PUT = celé nastavení najednou; chybějící pole se vrací na výchozí hodnotu
     * ze schématu, ne na tu dosud uloženou.
     *
     * @param  TeamSettings $settings
     * @return TeamSettings
     */
    public function saveSettings(Identity $identity, int $teamId, array $settings): array
    {
        $this->scope->team($identity, $teamId, Role::Admin);

        if (!in_array($settings['settlementPeriod'], self::SETTLEMENT_PERIODS, true)) {
            throw ApiException::validation('Neznámé období zúčtování.', ['field' => 'settlementPeriod']);
        }

        // Domácí hala musí patřit témuž klubu, jinak by šlo přes cizí ID zjistit,
        // jaká místa mají ostatní kluby.
        if ($settings['homeLocationId'] !== null) {
            $belongs = $this->db->value(
                'SELECT l.id
                   FROM location l
                   JOIN team t ON t.club_id = l.club_id
                  WHERE l.id = ? AND t.id = ?',
                [$settings['homeLocationId'], $teamId],
            );

            if ($belongs === null) {
                throw ApiException::validation('Zvolené místo nepatří tomuto klubu.', ['field' => 'homeLocationId']);
            }
        }

        $this->db->run(
            'INSERT INTO team_settings
                 (team_id, home_location_id, travel_enabled, travel_rate_czk_km, travel_round_trip,
                  settlement_period, attendance_visible_to_players, balances_visible_to_players)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?)
             ON DUPLICATE KEY UPDATE
                 home_location_id              = VALUES(home_location_id),
                 travel_enabled                = VALUES(travel_enabled),
                 travel_rate_czk_km            = VALUES(travel_rate_czk_km),
                 travel_round_trip             = VALUES(travel_round_trip),
                 settlement_period             = VALUES(settlement_period),
                 attendance_visible_to_players = VALUES(attendance_visible_to_players),
                 balances_visible_to_players   = VALUES(balances_visible_to_players)',
            [
                $teamId,
                $settings['homeLocationId'],
                (int) $settings['travelEnabled'],
                number_format($settings['travelRateCzkKm'], 2, '.', ''),
                (int) $settings['travelRoundTrip'],
                $settings['settlementPeriod'],
                (int) $settings['attendanceVisibleToPlayers'],
                (int) $settings['balancesVisibleToPlayers'],
            ],
        );

        return $this->settings($teamId);
    }

    /**
     * Družstvo nesmí přijít o posledního admina.
     *
     * Bez téhle pojistky by šlo omylem odebrat roli sám sobě a družstvo by
     * zůstalo bez správce — zvenčí by to spravil jen zásah do databáze, protože
     * roli uděluje admin téhož družstva. Předání role se dělá obráceně: nejdřív
     * povýšit nástupce, pak sebe degradovat.
     *
     * @param array<string,mixed>                                     $current
     * @param array{role?:Role,jerseyNumber?:int|null,status?:string} $changes
     */
    private function assertNotLastAdmin(array $current, array $changes): void
    {
        if ((string) $current['role'] !== Role::Admin->value) {
            return;
        }

        $losesRole   = isset($changes['role']) && $changes['role'] !== Role::Admin;
        $leavesTeam  = ($changes['status'] ?? null) === 'left';

        if (!$losesRole && !$leavesTeam) {
            return;
        }

        $others = (int) $this->db->value(
            "SELECT COUNT(*) FROM membership
              WHERE team_id = ? AND id <> ? AND role = 'admin' AND status <> 'left'",
            [$current['team_id'], $current['id']],
        );

        if ($others === 0) {
            throw ApiException::conflict(
                'LAST_ADMIN',
                'Družstvo by zůstalo bez admina. Nejdřív jmenujte jiného.',
            );
        }
    }

    /** Adresa v URL klubu: bez diakritiky, malá písmena, a unikátní. */
    private function uniqueClubSlug(string $name): string
    {
        $ascii = iconv('UTF-8', 'ASCII//TRANSLIT', $name);
        $base  = trim(preg_replace('/[^a-z0-9]+/', '-', mb_strtolower($ascii === false ? $name : $ascii)) ?? '', '-');

        if ($base === '') {
            $base = 'klub';
        }

        $base = mb_substr($base, 0, 50);
        $slug = $base;

        // Slug musí být unikátní (má unikátní index), takže se při shodě čísluje.
        for ($suffix = 2; $this->db->value('SELECT id FROM club WHERE slug = ?', [$slug]) !== null; $suffix++) {
            $slug = $base . '-' . $suffix;
        }

        return $slug;
    }

    /**
     * @return TeamDetail
     */
    private function teamPayload(int $teamId): array
    {
        $team = $this->db->first(
            'SELECT t.id, t.name, t.color, t.archived_at, c.id AS club_id, c.name AS club_name,
                    (SELECT COUNT(*) FROM membership m WHERE m.team_id = t.id AND m.status <> \'left\') AS member_count
               FROM team t
               JOIN club c ON c.id = t.club_id
              WHERE t.id = ?',
            [$teamId],
        );

        if ($team === null) {
            throw ApiException::notFound();
        }

        return [
            'id'          => (int) $team['id'],
            'name'        => (string) $team['name'],
            'color'       => $team['color'] === null ? null : (string) $team['color'],
            'archivedAt'  => $team['archived_at'] === null ? null : (string) $team['archived_at'],
            'clubId'      => (int) $team['club_id'],
            'clubName'    => (string) $team['club_name'],
            'memberCount' => (int) $team['member_count'],
            'settings'    => $this->settings($teamId),
        ];
    }

    /**
     * @return TeamSettings
     */
    private function settings(int $teamId): array
    {
        $row = $this->db->first(
            'SELECT home_location_id, travel_enabled, travel_rate_czk_km, travel_round_trip,
                    settlement_period, attendance_visible_to_players, balances_visible_to_players
               FROM team_settings WHERE team_id = ?',
            [$teamId],
        );

        // Řádek vzniká až prvním uložením; do té doby platí výchozí hodnoty ze schématu.
        if ($row === null) {
            return [
                'travelEnabled'              => false,
                'travelRateCzkKm'            => 5.0,
                'travelRoundTrip'            => true,
                'settlementPeriod'           => 'none',
                'homeLocationId'             => null,
                'attendanceVisibleToPlayers' => false,
                'balancesVisibleToPlayers'   => true,
            ];
        }

        return [
            'travelEnabled'              => (bool) $row['travel_enabled'],
            'travelRateCzkKm'            => (float) $row['travel_rate_czk_km'],
            'travelRoundTrip'            => (bool) $row['travel_round_trip'],
            'settlementPeriod'           => (string) $row['settlement_period'],
            'homeLocationId'             => $row['home_location_id'] === null ? null : (int) $row['home_location_id'],
            'attendanceVisibleToPlayers' => (bool) $row['attendance_visible_to_players'],
            'balancesVisibleToPlayers'   => (bool) $row['balances_visible_to_players'],
        ];
    }

    /**
     * @return TeamMember
     */
    private function memberPayload(int $membershipId): array
    {
        $row = $this->db->first(
            'SELECT m.id, m.user_id, m.role, m.status, m.jersey_number, m.payment_reference, m.joined_at,
                    u.display_name, u.email, u.password_hash IS NOT NULL AS has_password
               FROM membership m
               JOIN `user` u ON u.id = m.user_id
              WHERE m.id = ?',
            [$membershipId],
        );

        if ($row === null) {
            throw ApiException::notFound();
        }

        return [
            'id'               => (int) $row['id'],
            'userId'           => (int) $row['user_id'],
            'name'             => (string) $row['display_name'],
            'email'            => (string) $row['email'],
            'role'             => (string) $row['role'],
            'status'           => (string) $row['status'],
            'jerseyNumber'     => $row['jersey_number'] === null ? null : (int) $row['jersey_number'],
            'paymentReference' => (string) $row['payment_reference'],
            'joinedAt'         => (string) $row['joined_at'],
            'hasPassword'      => (bool) $row['has_password'],
        ];
    }
}
