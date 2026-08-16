<?php

declare(strict_types=1);

namespace Pina\Mail;

use PHPMailer\PHPMailer\Exception as PHPMailerException;
use PHPMailer\PHPMailer\PHPMailer;
use Pina\Support\Config;
use Pina\Support\Logger;

/**
 * SMTP Zoner (ne `mail()`): mail z hostingu by skončila ve spamu.
 * `MAIL_ENABLED=false` chrání reálné adresy při vývoji (DB je kopie ostré).
 */
final class SmtpMailer implements Mailer
{
    /** Jednoduché spojení pro celou dávku — šetří přihlášení. */
    private ?PHPMailer $connection = null;

    private function __construct(
        private readonly Logger $logger,
        private readonly bool $enabled,
        private readonly string $host,
        private readonly int $port,
        private readonly string $encryption,
        private readonly string $username,
        private readonly string $password,
        private readonly string $fromEmail,
        private readonly string $fromName,
        private readonly Allowlist $allowlist,
    ) {
    }

    public static function fromConfig(Logger $logger): self
    {
        return new self(
            logger:     $logger,
            enabled:    Config::bool('MAIL_ENABLED'),
            host:       Config::get('MAIL_HOST', 'smtp.zoner.com'),
            port:       Config::int('MAIL_PORT', 465),
            encryption: Config::get('MAIL_ENCRYPTION', 'ssl'),
            username:   Config::get('MAIL_USERNAME', ''),
            password:   Config::get('MAIL_PASSWORD', ''),
            fromEmail:  Config::get('MAIL_FROM', 'pina@pinaprosek.eu'),
            fromName:   Config::get('MAIL_FROM_NAME', 'Pína'),
            allowlist:  Allowlist::fromConfig(),
        );
    }

    public function enabled(): bool
    {
        // Bez hesla nelze se přihlásit, je lépe hlásit vypnuto.
        return $this->enabled && $this->password !== '';
    }

    public function send(string $toEmail, string $toName, string $subject, string $html, string $text): bool
    {
        if (!$this->enabled()) {
            // Adresa se loguje schválně, obsah ne — v logu nemá co dělat token.
            $this->logger->info('Odesílání e-mailů je vypnuté, zpráva neodešla.', [
                'to'      => $toEmail,
                'subject' => $subject,
            ]);

            return false;
        }

        if (!$this->allowlist->permits($toEmail)) {
            // Neodesíláme na adresy mimo allowlist (pojistka proti rozeslání do vývoje).
            $this->logger->info('Adresa není na seznamu povolených, zpráva neodešla.', [
                'to'      => $toEmail,
                'subject' => $subject,
                'seznam'  => $this->allowlist->describe(),
            ]);

            return false;
        }

        try {
            $mailer = $this->connection();
            $mailer->clearAllRecipients();
            $mailer->addAddress($toEmail, $toName);
            $mailer->Subject = $subject;
            $mailer->Body    = $html;
            $mailer->AltBody = $text;

            return $mailer->send();
        } catch (PHPMailerException $e) {
            // Selhání jedné adresy nesmí shodit dávku — volající dostane false.
            $this->logger->error($e, ['to' => $toEmail, 'subject' => $subject]);

            return false;
        }
    }

    private function connection(): PHPMailer
    {
        if ($this->connection !== null) {
            return $this->connection;
        }

        $mailer = new PHPMailer(exceptions: true);
        $mailer->isSMTP();
        $mailer->Host       = $this->host;
        $mailer->Port       = $this->port;
        $mailer->SMTPAuth   = true;
        $mailer->Username   = $this->username;
        $mailer->Password   = $this->password;
        $mailer->SMTPSecure = $this->encryption === 'tls'
            ? PHPMailer::ENCRYPTION_STARTTLS
            : PHPMailer::ENCRYPTION_SMTPS;
        $mailer->SMTPKeepAlive = true;
        $mailer->CharSet       = PHPMailer::CHARSET_UTF8;
        $mailer->isHTML(true);
        $mailer->setFrom($this->fromEmail, $this->fromName);

        $this->connection = $mailer;

        return $mailer;
    }
}
