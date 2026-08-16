<?php

declare(strict_types=1);

namespace Pina\Tests\Support;

use Pina\Mail\Mailer;

/**
 * Poštovní přihrádka pro testy. Nic neodesílá, jen si zprávy schová, aby se
 * dalo ověřit, komu co odešlo — a hlavně aby testy nikdy nesáhly na skutečný
 * SMTP server. Aplikace pracuje s reálnými adresami reálných lidí.
 */
final class FakeMailer implements Mailer
{
    /** @var list<array{to:string,name:string,subject:string,html:string,text:string}> */
    public array $sent = [];

    /**
     * Odesílání sice zapnuté, ale každá zpráva selže — tak se chová zamítnutá
     * adresa nebo výpadek SMTP uprostřed dávky.
     */
    public bool $refuseAll = false;

    /** Nastavením na `false` se simuluje vypnuté odesílání. */
    public function __construct(private bool $enabled = true)
    {
    }

    public function enabled(): bool
    {
        return $this->enabled;
    }

    public function send(string $toEmail, string $toName, string $subject, string $html, string $text): bool
    {
        if (!$this->enabled || $this->refuseAll) {
            return false;
        }

        $this->sent[] = [
            'to'      => $toEmail,
            'name'    => $toName,
            'subject' => $subject,
            'html'    => $html,
            'text'    => $text,
        ];

        return true;
    }

    /** @return list<string> adresy v pořadí odeslání */
    public function recipients(): array
    {
        return array_map(static fn (array $message): string => $message['to'], $this->sent);
    }

    /** Poslední zpráva, nebo `null` když žádná neodešla. */
    public function last(): ?string
    {
        $message = $this->sent === [] ? null : $this->sent[count($this->sent) - 1];

        return $message === null ? null : $message['text'];
    }
}
