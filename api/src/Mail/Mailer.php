<?php

declare(strict_types=1);

namespace Pina\Mail;

/**
 * Rozhraní odděluje obsah zprávy od způsobu doručení (testování bez SMTP).
 */
interface Mailer
{
    /**
     * Vrací `true`, jen když zpráva skutečně odešla. `false` znamená vypnuté
     * odesílání nebo chybu — volající pak musí nabídnout odkaz ručně, ne tvrdit
     * uživateli, že je hotovo.
     */
    public function send(string $toEmail, string $toName, string $subject, string $html, string $text): bool;

    /** Má vůbec smysl odesílání nabízet? */
    public function enabled(): bool;
}
