<?php

declare(strict_types=1);

namespace Pina\Tests\Support;

use PHPUnit\Framework\Attributes\DataProvider;
use PHPUnit\Framework\TestCase;
use Pina\Http\ApiException;
use Pina\Support\CzechPhone;

final class CzechPhoneTest extends TestCase
{
    public function testNormalizesCzechNumbersAndEmptyValues(): void
    {
        foreach (['777123456', '777 123 456', '+420 777 123 456', '00420 777 123 456', "+420\u{00a0}777\u{00a0}123\u{00a0}456"] as $phone) {
            self::assertSame('+420777123456', CzechPhone::normalize($phone));
        }
        self::assertSame('+420212345678', CzechPhone::normalize('212 345 678'));
        foreach ([null, '', " \t\n", "\u{00a0}"] as $phone) {
            self::assertNull(CzechPhone::normalize($phone));
        }
    }

    #[DataProvider('invalidPhones')]
    public function testRejectsInvalidNumbers(string $phone): void
    {
        try {
            CzechPhone::normalize($phone);
            self::fail('Neplatný telefon nesmí projít.');
        } catch (ApiException $error) {
            self::assertSame(400, $error->status);
            self::assertSame('phone', $error->details['field']);
        }
    }

    /** @return list<array{string}> */
    public static function invalidPhones(): array
    {
        return [['123'], ['7771234567'], ['+421777123456'], ['420777123456'], ['+420'], ['077123456'], ['777abc456'], ['777123456;123'], ['<script>777123456</script>']];
    }
}
