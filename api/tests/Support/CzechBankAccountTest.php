<?php

declare(strict_types=1);

namespace Pina\Tests\Support;

use InvalidArgumentException;
use PHPUnit\Framework\TestCase;
use Pina\Support\CzechBankAccount;

final class CzechBankAccountTest extends TestCase
{
    public function testConvertsLocalAccountToIban(): void
    {
        self::assertSame('CZ6508000000192000145399', CzechBankAccount::iban('19-2000145399/0800'));
        self::assertSame('CZ6508000000192000145399', CzechBankAccount::iban('CZ65 0800 0000 1920 0014 5399'));
    }

    public function testRejectsInvalidIbanChecksum(): void
    {
        $this->expectException(InvalidArgumentException::class);
        CzechBankAccount::normalize('CZ0008000000192000145399');
    }
}
