<?php

declare(strict_types=1);

namespace Pina\Auth;

use Pina\Http\ApiException;
use Pina\Mail\PasswordResetMail;
use Pina\Support\Database;

/**
 * Obnova zapomenutého hesla.
 *
 * Bez ní je člověk, který si heslo nastavil a zapomněl, zamčený nadobro —
 * aktivační odkaz účty s heslem odmítá, aby jím nešlo převzít cizí účet.
 *
 * Odkaz je mocnější než pozvánka (přepisuje existující heslo), proto platí
 * hodinu místo tří dnů. Vydává se výhradně samoobslužně na e-mail; admin nemá
 * jak heslo někomu zrušit, jinak by z toho byl nástroj na převzetí účtu.
 */
final class PasswordResetService
{
    private const TTL_MINUTES = 60;

    /** Kolik odkazů smí jedna adresa dostat za hodinu, ať nejde zaplavit schránka. */
    private const MAX_PER_HOUR = 3;

    public function __construct(
        private readonly Database $db,
        private readonly TokenService $tokens,
        private readonly PasswordService $passwords,
        private readonly PasswordResetMail $mails,
    ) {
    }

    /**
     * Vyžádání odkazu.
     *
     * Nikdy neprozradí, jestli adresa v aplikaci je — jinak by z endpointu byl
     * seznam registrovaných. Volající proto dostane `void` a klient hlásí totéž
     * pro známou i neznámou adresu.
     */
    public function request(string $email, ?string $ip): void
    {
        $email = mb_strtolower(trim($email));

        $user = $this->db->first(
            'SELECT id, display_name, password_hash FROM `user` WHERE email = ?',
            [$email],
        );

        // Účet bez hesla se řeší aktivačním odkazem od admina, ne resetem —
        // jinak by šlo přes reset obsadit účet, který si nikdo ještě nepřevzal.
        if ($user === null || $user['password_hash'] === null) {
            return;
        }

        $userId = (int) $user['id'];

        $recent = (int) $this->db->value(
            'SELECT COUNT(*) FROM password_reset
              WHERE user_id = ? AND created_at > DATE_SUB(NOW(), INTERVAL 1 HOUR)',
            [$userId],
        );

        if ($recent >= self::MAX_PER_HOUR) {
            return;
        }

        $token = bin2hex(random_bytes(32));

        // Starší nevyužité odkazy propadnou, ale řádek zůstává — platit má vždycky
        // jen ten poslední a mazání by rozbilo počítání výše.
        $this->db->run(
            'UPDATE password_reset SET expires_at = DATE_SUB(NOW(), INTERVAL 1 SECOND)
              WHERE user_id = ? AND used_at IS NULL',
            [$userId],
        );

        $this->db->run(
            'INSERT INTO password_reset (user_id, token_hash, expires_at)
             VALUES (?, ?, DATE_ADD(NOW(), INTERVAL ? MINUTE))',
            [$userId, hash('sha256', $token), self::TTL_MINUTES],
        );

        $this->mails->send($email, (string) $user['display_name'], $token, self::TTL_MINUTES, $ip);
    }

    /**
     * Nastavení nového hesla podle odkazu. Vrací id uživatele, aby ho volající
     * mohl rovnou přihlásit.
     */
    public function complete(string $token, string $password): int
    {
        $reset = $this->db->first(
            'SELECT id, user_id, used_at, expires_at < NOW() AS expired
               FROM password_reset WHERE token_hash = ?',
            [hash('sha256', $token)],
        );

        if ($reset === null || $reset['used_at'] !== null || (bool) $reset['expired']) {
            throw ApiException::validation('Odkaz je neplatný, už byl použitý nebo mu vypršela platnost.');
        }

        $this->passwords->assertStrong($password);

        $userId = (int) $reset['user_id'];

        $this->db->transaction(function () use ($reset, $userId, $password): void {
            $this->db->run(
                'UPDATE `user` SET password_hash = ? WHERE id = ?',
                [$this->passwords->hash($password), $userId],
            );

            $this->db->run('UPDATE password_reset SET used_at = NOW() WHERE id = ?', [$reset['id']]);
        });

        // Odhlášení všude: kdyby se někdo dostal dovnitř se starým heslem,
        // tímhle vypadne. Přesně proto se reset dělá.
        $this->tokens->revokeAllForUser($userId);
        $this->tokens->invalidateAccessTokens($userId);

        return $userId;
    }
}
