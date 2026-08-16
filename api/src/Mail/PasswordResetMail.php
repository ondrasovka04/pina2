<?php

declare(strict_types=1);

namespace Pina\Mail;

/**
 * Zpráva s odkazem na obnovu hesla.
 *
 * Zmiňuje IP, ze které o odkaz někdo požádal — když si o něj člověk neřekl,
 * je to jediné vodítko, že se o jeho účet někdo pokouší.
 */
final class PasswordResetMail
{
    public function __construct(
        private readonly Mailer $mailer,
        private readonly string $appUrl,
    ) {
    }

    public function send(string $email, string $name, string $token, int $ttlMinutes, ?string $ip): bool
    {
        $link    = rtrim($this->appUrl, '/') . '/nove-heslo?token=' . urlencode($token);
        $safe    = htmlspecialchars($link, ENT_QUOTES | ENT_SUBSTITUTE, 'UTF-8');
        $odkud   = $ip === null ? '' : sprintf(' Požadavek přišel z adresy %s.', $this->escape($ip));
        $platnos = sprintf('Odkaz platí %d minut a jde použít jednou.', $ttlMinutes);

        return $this->mailer->send(
            $email,
            $name,
            'Obnova hesla do píny',
            <<<HTML
                <!doctype html>
                <html lang="cs"><body style="margin:0;padding:24px;background:#f3f5f9;font-family:system-ui,-apple-system,'Segoe UI',sans-serif">
                  <div style="max-width:520px;margin:0 auto;background:#fff;border-radius:16px;padding:28px">
                    <h1 style="margin:0 0 16px;font-size:20px;color:#062372">Nastavení nového hesla</h1>
                    <p style="margin:0 0 12px;font-size:15px;line-height:1.5;color:#334">$platnos</p>
                    <p style="margin:24px 0">
                      <a href="$safe" style="display:inline-block;background:#062372;color:#fff;text-decoration:none;padding:12px 20px;border-radius:12px;font-weight:600">Nastavit nové heslo</a>
                    </p>
                    <p style="margin:0 0 12px;font-size:13px;line-height:1.5;color:#8892a6">
                      Pokud jste o obnovu nežádali, nemusíte dělat nic — dosavadní heslo platí dál.$odkud
                    </p>
                    <p style="margin:0;font-size:12px;color:#8892a6">
                      Kdyby tlačítko nefungovalo, otevřete tuhle adresu:<br>
                      <span style="word-break:break-all">$safe</span>
                    </p>
                  </div>
                </body></html>
                HTML,
            "Nové heslo si nastavíte tady:\n$link\n\n$platnos\n\n"
                . 'Pokud jste o obnovu nežádali, nemusíte dělat nic — dosavadní heslo platí dál.'
                . ($ip === null ? '' : sprintf(' Požadavek přišel z adresy %s.', $ip)) . "\n",
        );
    }

    private function escape(string $value): string
    {
        return htmlspecialchars($value, ENT_QUOTES | ENT_SUBSTITUTE, 'UTF-8');
    }
}
