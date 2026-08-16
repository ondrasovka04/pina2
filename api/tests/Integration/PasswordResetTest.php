<?php

declare(strict_types=1);

namespace Pina\Tests\Integration;

use Pina\Auth\PasswordResetService;
use Pina\Auth\PasswordService;
use Pina\Auth\TokenService;
use Pina\Http\ApiException;
use Pina\Mail\PasswordResetMail;
use Pina\Tests\Support\FakeMailer;

/** Obnova zapomenutého hesla: nesmí prozradit, kdo je v aplikaci, ani nechat platit starou relaci. */
final class PasswordResetTest extends DatabaseTestCase
{
    private PasswordResetService $service;
    private PasswordService $passwords;
    private TokenService $tokens;
    private FakeMailer $mailer;

    private int $userId;

    protected function setUp(): void
    {
        parent::setUp();

        $this->passwords = new PasswordService();
        $this->tokens    = new TokenService($this->db);
        $this->mailer    = new FakeMailer();
        $this->service   = new PasswordResetService(
            $this->db,
            $this->tokens,
            $this->passwords,
            new PasswordResetMail($this->mailer, 'https://pinaprosek.eu'),
        );

        $this->userId = $this->makeUser('hrac@prosek.cz');
        $this->setPassword('puvodni-heslo-2026');
    }

    public function testResetLinkArrivesAndSetsNewPassword(): void
    {
        $this->service->request('hrac@prosek.cz', '192.0.2.10');

        self::assertSame(['hrac@prosek.cz'], $this->mailer->recipients());

        $userId = $this->service->complete($this->tokenFromMail(), 'uplne-nove-heslo-2026');

        self::assertSame($this->userId, $userId);
        self::assertTrue($this->passwordMatches('uplne-nove-heslo-2026'));
        self::assertFalse($this->passwordMatches('puvodni-heslo-2026'));
    }

    public function testOnlyHashIsStored(): void
    {
        $this->service->request('hrac@prosek.cz', null);
        $token = $this->tokenFromMail();

        $row = $this->db->first('SELECT token_hash, used_at FROM password_reset WHERE user_id = ?', [$this->userId]);

        self::assertNotNull($row);
        self::assertSame(hash('sha256', $token), (string) $row['token_hash']);
        self::assertNull($row['used_at']);
    }

    public function testUnknownAddressIsSilentlyIgnored(): void
    {
        // Odpověď se nesmí lišit od známé adresy, jinak by z endpointu byl
        // seznam registrovaných.
        $this->service->request('nikdo@nikde.cz', null);

        self::assertSame([], $this->mailer->sent);
        self::assertSame(0, (int) $this->db->value('SELECT COUNT(*) FROM password_reset'));
    }

    public function testAccountWithoutPasswordGetsNoResetLink(): void
    {
        // Nepřevzatý účet se řeší aktivací od admina. Reset by z něj udělal
        // cestu, jak si cizí nepoužitý účet obsadit.
        $this->db->run('UPDATE `user` SET password_hash = NULL WHERE id = ?', [$this->userId]);

        $this->service->request('hrac@prosek.cz', null);

        self::assertSame([], $this->mailer->sent);
    }

    public function testUsedLinkCannotBeUsedTwice(): void
    {
        $this->service->request('hrac@prosek.cz', null);
        $token = $this->tokenFromMail();

        $this->service->complete($token, 'prvni-nove-heslo-2026');

        try {
            $this->service->complete($token, 'druhe-nove-heslo-2026');
            self::fail('odkaz platí jen na jedno použití');
        } catch (ApiException $e) {
            self::assertSame(400, $e->status);
        }

        self::assertTrue($this->passwordMatches('prvni-nove-heslo-2026'));
    }

    public function testExpiredLinkIsRejected(): void
    {
        $this->service->request('hrac@prosek.cz', null);
        $token = $this->tokenFromMail();

        $this->db->run('UPDATE password_reset SET expires_at = DATE_SUB(NOW(), INTERVAL 1 MINUTE)');

        try {
            $this->service->complete($token, 'nove-heslo-2026');
            self::fail('propadlý odkaz nesmí projít');
        } catch (ApiException $e) {
            self::assertSame(400, $e->status);
        }

        self::assertTrue($this->passwordMatches('puvodni-heslo-2026'));
    }

    public function testNewRequestInvalidatesThePreviousLink(): void
    {
        $this->service->request('hrac@prosek.cz', null);
        $first = $this->tokenFromMail();

        $this->service->request('hrac@prosek.cz', null);
        $second = $this->tokenFromMail();

        self::assertNotSame($first, $second);

        try {
            $this->service->complete($first, 'nove-heslo-2026');
            self::fail('starší odkaz musí přestat platit');
        } catch (ApiException $e) {
            self::assertSame(400, $e->status);
        }

        self::assertSame($this->userId, $this->service->complete($second, 'nove-heslo-2026'));
    }

    public function testTooManyRequestsStopSendingWithoutTellingTheCaller(): void
    {
        // Bez brzdy by šlo někomu zaplavit schránku. Volající se to nedozví —
        // odpověď musí být stejná jako u úspěchu.
        for ($i = 0; $i < 5; $i++) {
            $this->service->request('hrac@prosek.cz', null);
        }

        self::assertCount(3, $this->mailer->sent);
    }

    public function testCompletedResetLogsOutEverywhere(): void
    {
        $pair = $this->tokens->issue($this->userId, 'Firefox', '192.0.2.10');
        $this->db->run("UPDATE `user` SET tokens_valid_from = '2020-01-01 00:00:00' WHERE id = ?", [$this->userId]);

        $this->service->request('hrac@prosek.cz', null);
        $this->service->complete($this->tokenFromMail(), 'nove-heslo-2026');

        // Refresh token je pryč...
        try {
            $this->tokens->refresh($pair['refreshToken'], 'Firefox', '192.0.2.10');
            self::fail('stará relace musí po obnově hesla skončit');
        } catch (ApiException $e) {
            self::assertSame(401, $e->status);
        }

        // ...a razítko posunuté, takže odmítne i dosud platný access token.
        self::assertNotSame(
            '2020-01-01 00:00:00',
            (string) $this->db->value('SELECT tokens_valid_from FROM `user` WHERE id = ?', [$this->userId]),
        );
    }

    public function testWeakPasswordIsRejectedAndLinkStaysUsable(): void
    {
        $this->service->request('hrac@prosek.cz', null);
        $token = $this->tokenFromMail();

        try {
            $this->service->complete($token, 'krat');
            self::fail('krátké heslo nesmí projít');
        } catch (ApiException $e) {
            self::assertSame('password', $e->details['field'] ?? null);
        }

        // Odkaz se nespotřeboval — člověk to smí zkusit s lepším heslem.
        self::assertSame($this->userId, $this->service->complete($token, 'dost-dlouhe-heslo-2026'));
    }

    private function setPassword(string $password): void
    {
        $this->db->run(
            'UPDATE `user` SET password_hash = ? WHERE id = ?',
            [$this->passwords->hash($password), $this->userId],
        );
    }

    private function passwordMatches(string $password): bool
    {
        $hash = $this->db->value('SELECT password_hash FROM `user` WHERE id = ?', [$this->userId]);

        return $this->passwords->verify($password, $hash === null ? null : (string) $hash);
    }

    /** Token se nikam neukládá, takže se čte z odeslané zprávy — stejně jako ho dostane uživatel. */
    private function tokenFromMail(): string
    {
        $text = (string) $this->mailer->last();

        preg_match('~/nove-heslo\?token=([0-9a-f]{64})~', $text, $match);

        if (!isset($match[1])) {
            self::fail('ve zprávě musí být odkaz s tokenem');
        }

        return $match[1];
    }
}
