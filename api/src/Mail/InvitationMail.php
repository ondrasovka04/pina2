<?php

declare(strict_types=1);

namespace Pina\Mail;

/**
 * Pozvánka (nový člen) a aktivace (heslo). Oba případy použijí stejný odkaz.
 */
final class InvitationMail
{
    public function __construct(
        private readonly Mailer $mailer,
        private readonly string $appUrl,
    ) {
    }

    public function enabled(): bool
    {
        return $this->mailer->enabled();
    }

    /** Nový člověk, kterého admin pozval do družstva. */
    public function sendInvitation(string $email, string $token, string $teamName, string $invitedBy): bool
    {
        $link = $this->link($token);

        return $this->mailer->send(
            $email,
            '',
            "Pozvánka do družstva $teamName",
            $this->html(
                nadpis: 'Jste zvaní do píny',
                odstavce: [
                    sprintf('%s vás přidal(a) do družstva <strong>%s</strong>.', $this->escape($invitedBy), $this->escape($teamName)),
                    'Pína je společná kasa družstva — vidíte v ní, co vám za sezónu naskočilo a za co.',
                    'Odkaz platí 72 hodin a jde použít jednou.',
                ],
                tlacitko: 'Nastavit heslo a vstoupit',
                link: $link,
            ),
            $this->text(
                sprintf('%s vás přidal(a) do družstva %s.', $invitedBy, $teamName),
                'Přes tenhle odkaz si nastavíte heslo a dostanete se do aplikace:',
                $link,
            ),
        );
    }

    /** Stávající člen, který se ještě nikdy nepřihlásil. */
    public function sendActivation(string $email, string $name, string $token, string $teamName): bool
    {
        $link = $this->link($token);

        return $this->mailer->send(
            $email,
            $name,
            'Přístup do píny — nastavte si heslo',
            $this->html(
                nadpis: 'Pína má novou verzi',
                odstavce: [
                    sprintf('Vaše členství v družstvu <strong>%s</strong> i celá historie zůstávají.', $this->escape($teamName)),
                    'Hesla se ale ze staré verze nepřenášela, takže si nastavte nové.',
                    'Odkaz platí 72 hodin a jde použít jednou.',
                ],
                tlacitko: 'Nastavit heslo',
                link: $link,
            ),
            $this->text(
                sprintf('Vaše členství v družstvu %s i historie zůstávají, hesla se ale nepřenášela.', $teamName),
                'Nové heslo si nastavíte tady:',
                $link,
            ),
        );
    }

    private function link(string $token): string
    {
        return rtrim($this->appUrl, '/') . '/pozvanka?token=' . urlencode($token);
    }

    /**
     * @param list<string> $odstavce už oescapované; bez šablonovacího systému.
     */
    private function html(string $nadpis, array $odstavce, string $tlacitko, string $link): string
    {
        // Styly musí být inline (Gmail a Seznam je zahazují).
        $body = '';
        foreach ($odstavce as $odstavec) {
            $body .= "<p style=\"margin:0 0 12px;font-size:15px;line-height:1.5;color:#334\">$odstavec</p>";
        }

        $safeLink = $this->escape($link);

        return <<<HTML
            <!doctype html>
            <html lang="cs"><body style="margin:0;padding:24px;background:#f3f5f9;font-family:system-ui,-apple-system,'Segoe UI',sans-serif">
              <div style="max-width:520px;margin:0 auto;background:#fff;border-radius:16px;padding:28px">
                <h1 style="margin:0 0 16px;font-size:20px;color:#062372">$nadpis</h1>
                $body
                <p style="margin:24px 0">
                  <a href="$safeLink" style="display:inline-block;background:#062372;color:#fff;text-decoration:none;padding:12px 20px;border-radius:12px;font-weight:600">$tlacitko</a>
                </p>
                <p style="margin:0;font-size:12px;color:#8892a6">
                  Kdyby tlačítko nefungovalo, otevřete tuhle adresu:<br>
                  <span style="word-break:break-all">$safeLink</span>
                </p>
              </div>
            </body></html>
            HTML;
    }

    private function text(string $uvod, string $vyzva, string $link): string
    {
        return "$uvod\n\n$vyzva\n$link\n\nOdkaz platí 72 hodin a jde použít jednou.\n";
    }

    private function escape(string $value): string
    {
        return htmlspecialchars($value, ENT_QUOTES | ENT_SUBSTITUTE, 'UTF-8');
    }
}
