<?php

declare(strict_types=1);

namespace Pina\Service;

use InvalidArgumentException;
use Pina\Auth\Identity;
use Pina\Auth\Role;
use Pina\Auth\TeamScope;
use Pina\Auth\TokenService;
use Pina\Http\ApiException;
use Pina\Mail\InvitationMail;
use Pina\Support\CzechBankAccount;
use Pina\Support\Database;
use Pina\Support\PaymentReference;
use Pina\Support\RsvpDeadline;

/**
 * Družstva, jejich členové a nastavení.
 *
 * Každá metoda si přístup ověřuje přes TeamScope — role se nikde nečte z tokenu,
 * ale z databáze, takže odebrané oprávnění platí okamžitě.
 *
 * @phpstan-type TeamSettings array{
 *     attendanceEnabled:bool,
 *     travelEnabled:bool,
 *     travelRateCzkKm:float,
 *     travelRoundTrip:bool,
 *     homeLocationId:int|null,
 *     attendanceVisibleToPlayers:bool,
 *     balancesVisibleToPlayers:bool,
 *     rsvpDeadlineTrainingHours:int|null,
 *     rsvpDeadlineMatchHours:int|null,
 *     bankAccount:string|null
 * }
 * @phpstan-type TeamDetail array{
 *     id:int,
 *     name:string,
 *     color:string|null,
 *     logoUrl:string|null,
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
 *     avatarUrl:string|null,
 *     email:string,
 *     phone:string|null,
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

    /** Nejkratší odstup mezi dvěma zprávami na tutéž adresu. */
    private const RESEND_COOLDOWN_SECONDS = 60;

    /** Kolik aktivačních e-mailů se rozešle na jedno kliknutí. */
    private const ACTIVATION_BATCH_SIZE = 25;

    /** Doména, kterou dostaly účty bez e-mailu ze staré databáze. */
    private const PLACEHOLDER_EMAIL_DOMAIN = '@pinaprosek.invalid';

    /**
     * Živé ('active') či skončené ('left') — mezistav z migrace byl zbytečný.
     *
     * @var list<string>
     */
    private const MEMBER_STATUSES = ['active', 'left'];

    private readonly AuditLog $audit;

    public function __construct(
        private readonly Database $db,
        private readonly TeamScope $scope,
        private readonly TokenService $tokens,
        private readonly InvitationMail $mails,
        ?AuditLog $audit = null,
    ) {
        $this->audit = $audit ?? new AuditLog($db, $scope);
    }

    /**
     * Družstva přihlášeného. Výběr je omezený jeho členstvími, proto se tu
     * TeamScope nepoužívá — není co ověřovat, cizí řádek se do výsledku nedostane.
     *
     * @return list<array{
     *     id:int,
     *     name:string,
     *     color:string|null,
     *     logoUrl:string|null,
     *     clubId:int,
     *     clubName:string,
     *     membershipId:int,
     *     role:string,
     *     archived:bool,
     *     attendanceEnabled:bool,
     *     travelEnabled:bool,
     *     currentSeason:array{id:int,name:string}|null
     * }>
     */
    public function myTeams(Identity $identity): array
    {
        $rows = $this->db->all(
            "SELECT t.id, t.name, t.color, t.archived_at,
                    t.logo_url,
                    c.id AS club_id, c.name AS club_name,
                    m.id AS membership_id, m.role,
                    COALESCE(ts.attendance_enabled, 1) AS attendance_enabled,
                    COALESCE(ts.travel_enabled, 0) AS travel_enabled,
                    s.id AS season_id, s.name AS season_name
               FROM membership m
               JOIN team t ON t.id = m.team_id
               JOIN club c ON c.id = t.club_id
               LEFT JOIN team_settings ts ON ts.team_id = t.id
               LEFT JOIN season s ON s.team_id = t.id AND s.is_current = 1
              WHERE m.user_id = ? AND m.status <> 'left'
              ORDER BY c.name, t.name",
            [$identity->userId],
        );

        return array_map(static fn (array $row): array => [
            'id'                => (int) $row['id'],
            'name'              => (string) $row['name'],
            'color'             => $row['color'] === null ? null : (string) $row['color'],
            'logoUrl'           => $row['logo_url'] === null ? null : (string) $row['logo_url'],
            'clubId'            => (int) $row['club_id'],
            'clubName'          => (string) $row['club_name'],
            'membershipId'      => (int) $row['membership_id'],
            'role'              => (string) $row['role'],
            'archived'          => $row['archived_at'] !== null,
            'attendanceEnabled' => (bool) $row['attendance_enabled'],
            // Kvůli popiskům a záložkám na obrazovkách peněz; bez toho by si je
            // musela každá z nich dotáhnout z detailu družstva zvlášť.
            'travelEnabled' => (bool) $row['travel_enabled'],
            'currentSeason' => $row['season_id'] === null ? null : [
                'id'   => (int) $row['season_id'],
                'name' => (string) $row['season_name'],
            ],
        ], $rows);
    }

    /**
     * Přehled klubů a družstev pro správce. Zdatnost (admini, aktivace, sezóny),
     * nikoli dluhy či peníze cizích klubů.
     *
     * @return list<array{
     *     id:int,
     *     name:string,
     *     slug:string,
     *     teams:list<array{
     *         id:int,
     *         name:string,
     *         archived:bool,
     *         memberCount:int,
     *         adminCount:int,
     *         activatedCount:int,
     *         seasonCount:int,
     *         currentSeason:string|null
     *     }>
     * }>
     */
    public function platformOverview(Identity $identity): array
    {
        if (!$identity->isPlatformAdmin) {
            throw ApiException::forbidden('Tahle část patří správci platformy.');
        }

        $rows = $this->db->all(
            "SELECT c.id AS club_id, c.name AS club_name, c.slug,
                    t.id AS team_id, t.name AS team_name, t.archived_at,
                    (SELECT COUNT(*) FROM membership m
                      WHERE m.team_id = t.id AND m.status <> 'left') AS member_count,
                    (SELECT COUNT(*) FROM membership m
                      WHERE m.team_id = t.id AND m.status <> 'left' AND m.role = 'admin') AS admin_count,
                    (SELECT COUNT(*) FROM membership m
                       JOIN `user` u ON u.id = m.user_id
                      WHERE m.team_id = t.id AND m.status <> 'left'
                        AND u.password_hash IS NOT NULL) AS activated_count,
                    (SELECT COUNT(*) FROM season s WHERE s.team_id = t.id) AS season_count,
                    cs.name AS current_season
               FROM club c
               LEFT JOIN team t ON t.club_id = c.id
               LEFT JOIN season cs ON cs.team_id = t.id AND cs.is_current = 1
              ORDER BY c.name, t.name",
        );

        $clubs = [];

        foreach ($rows as $row) {
            $clubId = (int) $row['club_id'];

            $clubs[$clubId] ??= [
                'id'    => $clubId,
                'name'  => (string) $row['club_name'],
                'slug'  => (string) $row['slug'],
                'teams' => [],
            ];

            // LEFT JOIN: klub bez jediného družstva vrací řádek s prázdným týmem.
            if ($row['team_id'] === null) {
                continue;
            }

            $clubs[$clubId]['teams'][] = [
                'id'             => (int) $row['team_id'],
                'name'           => (string) $row['team_name'],
                'archived'       => $row['archived_at'] !== null,
                'memberCount'    => (int) $row['member_count'],
                'adminCount'     => (int) $row['admin_count'],
                'activatedCount' => (int) $row['activated_count'],
                'seasonCount'    => (int) $row['season_count'],
                'currentSeason'  => $row['current_season'] === null ? null : (string) $row['current_season'],
            ];
        }

        return array_values($clubs);
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
     * Řetěz oprávnění se tím uzavírá sám a nerozhoduje o něm žádné pevné ID, jen
     * role v klubu (viz TeamScope::club).
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

        $canSeePhones = $this->canSeePhones($identity, $teamId);

        $rows = $this->db->all(
            'SELECT m.id, m.user_id, m.role, m.status, m.jersey_number, m.payment_reference, m.joined_at,
                    u.display_name, u.email, u.avatar_url, CASE WHEN ? THEN u.phone ELSE NULL END AS phone, u.password_hash IS NOT NULL AS has_password
               FROM membership m
               JOIN `user` u ON u.id = m.user_id
              WHERE m.team_id = ?
              ORDER BY FIELD(m.status, \'active\', \'left\'), u.display_name',
            [$canSeePhones ? 1 : 0, $teamId],
        );

        return array_map(static fn (array $row): array => [
            'id'               => (int) $row['id'],
            'userId'           => (int) $row['user_id'],
            'name'             => (string) $row['display_name'],
            'avatarUrl'        => $row['avatar_url'] === null ? null : (string) $row['avatar_url'],
            'email'            => (string) $row['email'],
            'phone'            => $row['phone'] === null ? null : (string) $row['phone'],
            'role'             => (string) $row['role'],
            'status'           => (string) $row['status'],
            'jerseyNumber'     => $row['jersey_number'] === null ? null : (int) $row['jersey_number'],
            'paymentReference' => (string) $row['payment_reference'],
            'joinedAt'         => (string) $row['joined_at'],
            // Kdo heslo nemá, ještě se nikdy nepřihlásil — admin mu vyrobí aktivační odkaz.
            'hasPassword' => (bool) $row['has_password'],
        ], $rows);
    }

    /**
     * Vytvoří pozvánku do týmu a volitelně ji pošle e-mailem.
     *
     * Token se vrací vždycky, i když pošta odešla — v DB zůstane jen otisk.
     * Admin má co poslat do chatu, když zpráva skončí ve spamu.
     *
     * @return array{id:int,email:string,role:string,expiresAt:string,token:string,emailSent:bool}
     */
    public function invite(Identity $identity, int $teamId, string $email, Role $role, bool $sendEmail = true): array
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

        $issued = $this->issueToken($teamId, $email, $role->value, $identity->userId);

        $sent = $sendEmail
            && $this->mails->sendInvitation($email, $issued['token'], $this->teamName($teamId), $identity->displayName);

        return [
            'id'        => $issued['id'],
            'email'     => $email,
            'role'      => $role->value,
            'expiresAt' => $issued['expiresAt'],
            'token'     => $issued['token'],
            'emailSent' => $sent,
        ];
    }

    /**
     * Pošle pozvánku znovu — s novým tokenem (původní server nezná).
     * Stará pozvánka se zneplatní; kdyby první zpráva unikla, je to bezpečné.
     *
     * @return array{id:int,email:string,role:string,expiresAt:string,token:string,emailSent:bool}
     */
    public function resendInvitation(Identity $identity, int $invitationId): array
    {
        $teamId = $this->scope->invitation($identity, $invitationId, Role::Admin);

        $invitation = $this->db->first(
            'SELECT email, role, accepted_at, TIMESTAMPDIFF(SECOND, created_at, NOW()) AS age
               FROM invitation WHERE id = ?',
            [$invitationId],
        );

        if ($invitation === null) {
            throw ApiException::notFound();
        }

        if ($invitation['accepted_at'] !== null) {
            throw ApiException::conflict(
                'INVITATION_ACCEPTED',
                'Pozvánka už byla přijata, posílat ji znovu není proč.',
                ['invitationId' => $invitationId],
            );
        }

        // Ochranu proti rozesílání jedné adrese pořád dokola (dvojklik, spam).
        $age = (int) $invitation['age'];
        if ($age < self::RESEND_COOLDOWN_SECONDS) {
            throw ApiException::tooManyRequests(
                'Pozvánka odešla teprve před chvílí. Zkuste to za minutu.',
                self::RESEND_COOLDOWN_SECONDS - $age,
            );
        }

        $email  = (string) $invitation['email'];
        $role   = (string) $invitation['role'];
        $issued = $this->issueToken($teamId, $email, $role, $identity->userId);
        $sent   = $this->mails->sendInvitation($email, $issued['token'], $this->teamName($teamId), $identity->displayName);

        return [
            'id'        => $issued['id'],
            'email'     => $email,
            'role'      => $role,
            'expiresAt' => $issued['expiresAt'],
            'token'     => $issued['token'],
            'emailSent' => $sent,
        ];
    }

    /**
     * Hromadné rozeslání e-mailů všem bez hesla. Dávka omezená (25 zpráv)
     * kvůli timeout a SMTP; odpověď říká, kolik zbývá.
     *
     * @return array{sent:int,failed:int,remaining:int,skipped:int}
     */
    public function sendActivationEmails(Identity $identity, int $teamId): array
    {
        $this->scope->team($identity, $teamId, Role::Admin);

        if (!$this->mails->enabled()) {
            throw ApiException::conflict(
                'MAIL_DISABLED',
                'Odesílání e-mailů je vypnuté. Vytvořte aktivační odkazy jednotlivě a pošlete je ručně.',
            );
        }

        $candidates = $this->db->all(
            "SELECT m.id, m.role, u.display_name, u.email
               FROM membership m
               JOIN `user` u ON u.id = m.user_id
              WHERE m.team_id = ? AND m.status <> 'left' AND u.password_hash IS NULL
                -- Přeskakovat, kdo již aktivační odkaz má (aby opakované
                -- kliknutí neobeslalo znovu lidi ze začátku). Hráč si heslo
                -- nastavuje jednou, takže se družstvo nefiltruje.
                AND NOT EXISTS (
                    SELECT 1 FROM invitation i
                     WHERE i.email = u.email
                       AND i.accepted_at IS NULL AND i.expires_at > NOW()
                )
              ORDER BY u.display_name",
            [$teamId],
        );

        // Účty ze staré databáze bez e-mailu dostaly zástupnou adresu; poslat
        // na ni nejde a admin jim musí adresu nejdřív doplnit.
        $reachable = array_values(array_filter(
            $candidates,
            static fn (array $row): bool => !str_ends_with((string) $row['email'], self::PLACEHOLDER_EMAIL_DOMAIN),
        ));

        $teamName = $this->teamName($teamId);
        $batch    = array_slice($reachable, 0, self::ACTIVATION_BATCH_SIZE);
        $sent     = 0;
        $failed   = 0;

        foreach ($batch as $row) {
            $email  = (string) $row['email'];
            $issued = $this->db->transaction(function () use ($email, $identity, $row, $teamId): array {
                $issued = $this->issueToken($teamId, $email, (string) $row['role'], $identity->userId);
                $this->audit->record($identity, $teamId, 'activation_link_issued', 'invitation', $issued['id'], [
                    'membershipId' => (int) $row['id'],
                ]);

                return $issued;
            });

            if ($this->mails->sendActivation($email, (string) $row['display_name'], $issued['token'], $teamName)) {
                $sent++;

                continue;
            }

            $failed++;

            // Nedoručenou pozvánku smazat — token nikdo neviděl a její
            // existence by adresáta na 3 dny vyřadila z dalších pokusů.
            $this->db->run('DELETE FROM invitation WHERE id = ?', [$issued['id']]);
        }

        return [
            'sent'      => $sent,
            'failed'    => $failed,
            'remaining' => count($reachable) - count($batch),
            'skipped'   => count($candidates) - count($reachable),
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
     * Aktivační odkaz pro člena bez hesla. Běžná pozvánka na existující
     * členství nesedne. Odkaz se vrací i po úspěšném odeslání pošty.
     *
     * Účtu s heslem se nevydá; `acceptInvitation` heslo přepisuje přes
     * COALESCE, takže odkazem nejde převzít cizí účet.
     *
     * @return array{email:string,role:string,expiresAt:string,token:string,emailSent:bool}
     */
    public function activationLink(Identity $identity, int $membershipId, bool $sendEmail = true): array
    {
        $teamId = $this->scope->membership($identity, $membershipId, Role::Admin);

        $member = $this->db->first(
            'SELECT m.role, u.display_name, u.email, u.password_hash
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
        if (str_ends_with($email, self::PLACEHOLDER_EMAIL_DOMAIN)) {
            throw ApiException::validation(
                'Člen nemá skutečnou e-mailovou adresu, nejdřív ji doplňte.',
                ['field' => 'email'],
            );
        }

        $role   = (string) $member['role'];
        $issued = $this->db->transaction(function () use ($email, $identity, $membershipId, $role, $teamId): array {
            $issued = $this->issueToken($teamId, $email, $role, $identity->userId);
            $this->audit->record($identity, $teamId, 'activation_link_issued', 'invitation', $issued['id'], [
                'membershipId' => $membershipId,
            ]);

            return $issued;
        });

        $sent = $sendEmail && $this->mails->sendActivation(
            $email,
            (string) $member['display_name'],
            $issued['token'],
            $this->teamName($teamId),
        );

        return [
            'email'     => $email,
            'role'      => $role,
            'expiresAt' => $issued['expiresAt'],
            'token'     => $issued['token'],
            'emailSent' => $sent,
        ];
    }

    /**
     * @param  array{name?:string,email?:string,role?:Role,jerseyNumber?:int|null,status?:string} $changes
     * @return TeamMember
     */
    public function updateMembership(Identity $identity, int $membershipId, array $changes): array
    {
        $this->scope->membership($identity, $membershipId, Role::Admin);

        $current = $this->db->first(
            'SELECT m.id, m.user_id, m.team_id, m.role, m.status, u.email
               FROM membership m
               JOIN `user` u ON u.id = m.user_id
              WHERE m.id = ?',
            [$membershipId],
        );

        if ($current === null) {
            throw ApiException::notFound();
        }

        $this->assertNotLastAdmin($current, $changes);

        $sets   = [];
        $params = [];
        $name   = null;
        $email  = null;

        // Jméno je na uživateli, ne na členství — projeví se všude.
        // Admin opravuje přezdívky ze staré verze.
        if (isset($changes['name'])) {
            $name = trim($changes['name']);

            if ($name === '') {
                throw ApiException::validation('Jméno nesmí být prázdné.', ['field' => 'name']);
            }
        }

        // Stejně jako jméno: e-mail patří uživateli, ne členství. Hlavní případ
        // je oprava zástupné adresy ze staré appky (@pinaprosek.invalid), na
        // kterou nejde vydat aktivační odkaz, nebo obyčejný překlep.
        if (isset($changes['email'])) {
            $email = $changes['email'];

            $conflict = $this->db->value(
                'SELECT id FROM `user` WHERE email = ? AND id <> ?',
                [$email, $current['user_id']],
            );

            if ($conflict !== null) {
                throw ApiException::validation('Tenhle e-mail už používá jiný účet.', ['field' => 'email']);
            }
        }

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
            $sets[] = $changes['status'] === 'left' ? 'left_at = NOW()' : 'left_at = NULL';
        }

        if ($sets === [] && !isset($changes['name']) && !isset($changes['email'])) {
            throw ApiException::validation('Není co upravit — pošlete alespoň jedno pole.');
        }

        $roleChanged   = isset($changes['role']) && $changes['role']->value !== (string) $current['role'];
        $statusChanged = isset($changes['status']) && $changes['status'] !== (string) $current['status'];
        $emailChanged  = $email !== null && $email !== (string) $current['email'];

        $this->db->transaction(function () use (
            $changes,
            $current,
            $email,
            $emailChanged,
            $identity,
            $membershipId,
            $name,
            $params,
            $roleChanged,
            $sets,
            $statusChanged,
        ): void {
            if ($name !== null) {
                $this->db->run(
                    'UPDATE `user` SET display_name = ? WHERE id = ?',
                    [$name, $current['user_id']],
                );
            }

            if ($email !== null) {
                $this->db->run('UPDATE `user` SET email = ? WHERE id = ?', [$email, $current['user_id']]);

                if ($emailChanged) {
                    // Zrušit nevyřízenou pozvánku pro starou adresu v tomhle družstvu —
                    // jinak by dřív vydaný aktivační odkaz pořád platil na chybnou adresu.
                    $this->db->run(
                        'DELETE FROM invitation WHERE team_id = ? AND email = ? AND accepted_at IS NULL',
                        [$current['team_id'], $current['email']],
                    );

                    // E-mail je osobní údaj, do stopy nepatří — jen že se stal a u koho.
                    $this->audit->record($identity, (int) $current['team_id'], 'email_changed', 'membership', $membershipId);
                }
            }

            if ($sets !== []) {
                // Do dotazu se skládají jen literály vypsané výše, hodnoty jdou parametrem.
                $params[] = $membershipId;
                $this->db->run('UPDATE membership SET ' . implode(', ', $sets) . ' WHERE id = ?', $params);
            }

            if ($roleChanged) {
                $this->audit->record($identity, (int) $current['team_id'], 'role_changed', 'membership', $membershipId, [
                    'oldRole' => (string) $current['role'],
                    'newRole' => $changes['role']->value,
                ]);
            }

            if ($statusChanged) {
                $this->audit->record($identity, (int) $current['team_id'], 'status_changed', 'membership', $membershipId, [
                    'oldStatus' => (string) $current['status'],
                    'newStatus' => (string) $changes['status'],
                ]);
            }

            // Oprávnění nese vydaný JWT, který platí ještě 15 minut. Změna
            // role nebo stavu proto zneplatní už vydané tokeny ve stejné transakci.
            if ($roleChanged || $statusChanged) {
                $this->tokens->onRoleChanged((int) $current['user_id']);
            }
        });

        return $this->memberPayload($membershipId, $this->canSeePhones($identity, (int) $current['team_id']));
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
        $current = $this->settings($teamId);

        try {
            $bankAccount = $settings['bankAccount'] === null
                ? null
                : CzechBankAccount::normalize($settings['bankAccount']);
        } catch (InvalidArgumentException $e) {
            throw ApiException::validation($e->getMessage(), ['field' => 'bankAccount']);
        }

        $this->assertRsvpDeadlineHours($settings['rsvpDeadlineTrainingHours'], 'rsvpDeadlineTrainingHours');
        $this->assertRsvpDeadlineHours($settings['rsvpDeadlineMatchHours'], 'rsvpDeadlineMatchHours');

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

        $auditChanges = [];
        if ($current['attendanceEnabled'] !== $settings['attendanceEnabled']) {
            $auditChanges['attendanceEnabled'] = [
                'old' => $current['attendanceEnabled'],
                'new' => $settings['attendanceEnabled'],
            ];
        }
        if ($current['bankAccount'] !== $bankAccount) {
            $auditChanges['bankAccount'] = ['old' => $current['bankAccount'], 'new' => $bankAccount];
        }
        if ($current['travelRateCzkKm'] !== $settings['travelRateCzkKm']) {
            $auditChanges['travelRateCzkKm'] = [
                'old' => $current['travelRateCzkKm'],
                'new' => $settings['travelRateCzkKm'],
            ];
        }
        foreach (['rsvpDeadlineTrainingHours', 'rsvpDeadlineMatchHours'] as $field) {
            if ($current[$field] !== $settings[$field]) {
                $auditChanges[$field] = ['old' => $current[$field], 'new' => $settings[$field]];
            }
        }

        $this->db->transaction(function () use ($auditChanges, $bankAccount, $identity, $settings, $teamId): void {
            // Účet leží ve stejném řádku jako ostatní nastavení, takže jeden příkaz
            // stačí — dřív se zapisoval na klub a transakce držela dvě tabulky pohromadě.
            $this->db->run(
                'INSERT INTO team_settings
                 (team_id, bank_account, home_location_id, travel_enabled, travel_rate_czk_km, travel_round_trip,
                  attendance_enabled, attendance_visible_to_players, balances_visible_to_players,
                  rsvp_deadline_training_hours, rsvp_deadline_match_hours)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
             ON DUPLICATE KEY UPDATE
                 bank_account                  = VALUES(bank_account),
                 home_location_id              = VALUES(home_location_id),
                 travel_enabled                = VALUES(travel_enabled),
                 travel_rate_czk_km            = VALUES(travel_rate_czk_km),
                 travel_round_trip             = VALUES(travel_round_trip),
                 attendance_enabled            = VALUES(attendance_enabled),
                 attendance_visible_to_players = VALUES(attendance_visible_to_players),
                 balances_visible_to_players   = VALUES(balances_visible_to_players),
                 rsvp_deadline_training_hours  = VALUES(rsvp_deadline_training_hours),
                 rsvp_deadline_match_hours     = VALUES(rsvp_deadline_match_hours)',
                [
                    $teamId,
                    $bankAccount,
                    $settings['homeLocationId'],
                    (int) $settings['travelEnabled'],
                    number_format($settings['travelRateCzkKm'], 2, '.', ''),
                    (int) $settings['travelRoundTrip'],
                    (int) $settings['attendanceEnabled'],
                    (int) $settings['attendanceVisibleToPlayers'],
                    (int) $settings['balancesVisibleToPlayers'],
                    $settings['rsvpDeadlineTrainingHours'],
                    $settings['rsvpDeadlineMatchHours'],
                ],
            );

            if ($auditChanges !== []) {
                $this->audit->record($identity, $teamId, 'settings_changed', 'team_settings', $teamId, $auditChanges);
            }
        });

        return $this->settings($teamId);
    }

    /**
     * Pojistka: lze odebrat roli či odejít jen pokud zbývá další admin.
     * Jinak by se družstvo bez správce opravilo jen ručním zásahem do DB.
     *
     * @param array<string,mixed>                                     $current
     * @param array{role?:Role,jerseyNumber?:int|null,status?:string} $changes
     */
    private function assertNotLastAdmin(array $current, array $changes): void
    {
        if ((string) $current['role'] !== Role::Admin->value) {
            return;
        }

        $losesRole  = isset($changes['role']) && $changes['role'] !== Role::Admin;
        $leavesTeam = ($changes['status'] ?? null) === 'left';

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

    /**
     * Vydá nový token na jedno použití. Starší pozvánky pro tutéž adresu
     * v témže družstvu se ruší, aby admin viděl jen poslední.
     *
     * @return array{id:int,token:string,expiresAt:string}
     */
    private function issueToken(int $teamId, string $email, string $role, int $invitedBy): array
    {
        $token = bin2hex(random_bytes(32));

        $this->db->run(
            'DELETE FROM invitation WHERE team_id = ? AND email = ? AND accepted_at IS NULL',
            [$teamId, $email],
        );

        $this->db->run(
            'INSERT INTO invitation (team_id, email, role, token_hash, expires_at, invited_by)
             VALUES (?, ?, ?, ?, DATE_ADD(NOW(), INTERVAL ? HOUR), ?)',
            [$teamId, $email, $role, hash('sha256', $token), self::INVITATION_TTL_HOURS, $invitedBy],
        );

        $id = $this->db->lastInsertId();

        return [
            'id'        => $id,
            'token'     => $token,
            'expiresAt' => (string) $this->db->value('SELECT expires_at FROM invitation WHERE id = ?', [$id]),
        ];
    }

    private function teamName(int $teamId): string
    {
        return (string) $this->db->value('SELECT name FROM team WHERE id = ?', [$teamId]);
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
            'SELECT t.id, t.name, t.color, t.logo_url, t.archived_at,
                    c.id AS club_id, c.name AS club_name,
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
            'logoUrl'     => $team['logo_url'] === null ? null : (string) $team['logo_url'],
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
            'SELECT ts.bank_account, ts.home_location_id, ts.travel_enabled, ts.travel_rate_czk_km,
                    ts.travel_round_trip, ts.attendance_visible_to_players,
                    ts.attendance_enabled, ts.balances_visible_to_players, ts.rsvp_deadline_training_hours,
                    ts.rsvp_deadline_match_hours, ts.team_id AS settings_team_id
               FROM team t
               LEFT JOIN team_settings ts ON ts.team_id = t.id
              WHERE t.id = ?',
            [$teamId],
        );

        // Tým by měl být ověřený předem, ale privátní metoda zůstane bezpečná i samostatně.
        if ($row === null) {
            throw ApiException::notFound();
        }

        return [
            'attendanceEnabled'          => (bool) ($row['attendance_enabled'] ?? true),
            'travelEnabled'              => (bool) ($row['travel_enabled'] ?? false),
            'travelRateCzkKm'            => (float) ($row['travel_rate_czk_km'] ?? 5.0),
            'travelRoundTrip'            => (bool) ($row['travel_round_trip'] ?? true),
            'homeLocationId'             => $row['home_location_id'] === null ? null : (int) $row['home_location_id'],
            'attendanceVisibleToPlayers' => (bool) ($row['attendance_visible_to_players'] ?? false),
            'balancesVisibleToPlayers'   => (bool) ($row['balances_visible_to_players'] ?? true),
            // Družstvo bez řádku nastavení termín má — výchozí stav je zapnuto.
            // Prázdná hodnota v existujícím řádku ho naopak vypíná.
            'rsvpDeadlineTrainingHours' => $row['settings_team_id'] === null
                ? RsvpDeadline::DEFAULT_TRAINING_HOURS
                : ($row['rsvp_deadline_training_hours'] === null ? null : (int) $row['rsvp_deadline_training_hours']),
            'rsvpDeadlineMatchHours' => $row['settings_team_id'] === null
                ? RsvpDeadline::DEFAULT_MATCH_HOURS
                : ($row['rsvp_deadline_match_hours'] === null ? null : (int) $row['rsvp_deadline_match_hours']),
            'bankAccount' => $row['bank_account'] === null ? null : (string) $row['bank_account'],
        ];
    }

    private function canSeePhones(Identity $identity, int $teamId): bool
    {
        // Provozní správce ani admin jiného družstva tím nezíská cizí kontakty.
        return $this->db->value(
            "SELECT role FROM membership WHERE user_id = ? AND team_id = ? AND status = 'active'",
            [$identity->userId, $teamId],
        ) === Role::Admin->value;
    }

    private function assertRsvpDeadlineHours(?int $hours, string $field): void
    {
        if ($hours !== null && ($hours < 1 || $hours > 720)) {
            throw ApiException::validation(
                'Termín pro zápis musí být 1 až 720 hodin před začátkem.',
                ['field' => $field],
            );
        }
    }

    /**
     * @return TeamMember
     */
    private function memberPayload(int $membershipId, bool $canSeePhones): array
    {
        $row = $this->db->first(
            'SELECT m.id, m.user_id, m.role, m.status, m.jersey_number, m.payment_reference, m.joined_at,
                    u.display_name, u.email, u.avatar_url, CASE WHEN ? THEN u.phone ELSE NULL END AS phone, u.password_hash IS NOT NULL AS has_password
               FROM membership m
               JOIN `user` u ON u.id = m.user_id
              WHERE m.id = ?',
            [$canSeePhones ? 1 : 0, $membershipId],
        );

        if ($row === null) {
            throw ApiException::notFound();
        }

        return [
            'id'               => (int) $row['id'],
            'userId'           => (int) $row['user_id'],
            'name'             => (string) $row['display_name'],
            'avatarUrl'        => $row['avatar_url'] === null ? null : (string) $row['avatar_url'],
            'email'            => (string) $row['email'],
            'phone'            => $row['phone'] === null ? null : (string) $row['phone'],
            'role'             => (string) $row['role'],
            'status'           => (string) $row['status'],
            'jerseyNumber'     => $row['jersey_number'] === null ? null : (int) $row['jersey_number'],
            'paymentReference' => (string) $row['payment_reference'],
            'joinedAt'         => (string) $row['joined_at'],
            'hasPassword'      => (bool) $row['has_password'],
        ];
    }
}
