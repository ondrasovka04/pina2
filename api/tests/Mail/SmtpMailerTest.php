<?php

declare(strict_types=1);

namespace Pina\Tests\Mail;

use PHPUnit\Framework\TestCase;
use Pina\Mail\Allowlist;

/** Povolená lista chrání vývojovou DB s reálnými adresami od omylu. */
final class SmtpMailerTest extends TestCase
{
    public function testEmptyListBlocksEverythingOutsideProduction(): void
    {
        $allowlist = new Allowlist([], requireExplicit: true);

        self::assertFalse($allowlist->permits('kdokoli@prosek.cz'));
    }

    public function testEmptyListSendsToEveryoneInProduction(): void
    {
        $allowlist = new Allowlist([], requireExplicit: false);

        self::assertTrue($allowlist->permits('kdokoli@prosek.cz'));
    }

    public function testOnlyListedAddressesGetThrough(): void
    {
        $allowlist = new Allowlist(['ondra@copymail.cz'], requireExplicit: true);

        self::assertTrue($allowlist->permits('ondra@copymail.cz'));
        self::assertFalse($allowlist->permits('spoluhrac@prosek.cz'));
    }

    public function testAddressComparisonIgnoresCaseAndSpaces(): void
    {
        $allowlist = new Allowlist(['ondra@copymail.cz'], requireExplicit: true);

        self::assertTrue($allowlist->permits('  Ondra@CopyMail.cz '));
    }

    public function testListAppliesInProductionToo(): void
    {
        // Zbývající seznam chrání i v produkci — bezpečněji než nic nehlídat.
        $allowlist = new Allowlist(['ondra@copymail.cz'], requireExplicit: false);

        self::assertFalse($allowlist->permits('spoluhrac@prosek.cz'));
    }

    public function testDescriptionNeverLeaksAddresses(): void
    {
        $allowlist = new Allowlist(['ondra@copymail.cz'], requireExplicit: true);

        // Adresy nesmí být v logu.
        self::assertStringNotContainsString('@', $allowlist->describe());
        self::assertSame('omezeno na 1 adres', $allowlist->describe());
    }
}
