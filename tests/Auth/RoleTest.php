<?php

declare(strict_types=1);

namespace Pina\Tests\Auth;

use Pina\Auth\Identity;
use Pina\Auth\Role;
use PHPUnit\Framework\Attributes\DataProvider;
use PHPUnit\Framework\TestCase;

final class RoleTest extends TestCase
{
    /** @return list<array{Role,Role,bool}> */
    public static function hierarchyProvider(): array
    {
        return [
            // admin zvládne všechno, včetně práce pínaře
            [Role::Admin,     Role::Admin,     true],
            [Role::Admin,     Role::Treasurer, true],
            [Role::Admin,     Role::Player,    true],
            // pínař na administraci týmu nedosáhne
            [Role::Treasurer, Role::Admin,     false],
            [Role::Treasurer, Role::Treasurer, true],
            [Role::Treasurer, Role::Player,    true],
            // hráč nesmí zapisovat prohřešky ani spravovat tým
            [Role::Player,    Role::Admin,     false],
            [Role::Player,    Role::Treasurer, false],
            [Role::Player,    Role::Player,    true],
        ];
    }

    #[DataProvider('hierarchyProvider')]
    public function testHierarchy(Role $actual, Role $required, bool $expected): void
    {
        self::assertSame($expected, $actual->allows($required));
    }

    public function testRoleIsPerTeamNotGlobal(): void
    {
        // Hráč u mužů (tým 1), pínař u juniorů (tým 2) — reálný scénář v SK Prosek.
        $identity = new Identity(
            userId: 42,
            email: 'hrac@example.com',
            displayName: 'Hráč',
            isPlatformAdmin: false,
            rolesByTeam: [1 => Role::Player, 2 => Role::Treasurer],
        );

        self::assertFalse($identity->hasRoleInTeam(1, Role::Treasurer), 'u mužů zapisovat nesmí');
        self::assertTrue($identity->hasRoleInTeam(2, Role::Treasurer), 'u juniorů zapisovat smí');
        self::assertFalse($identity->isMemberOf(3), 'do cizího týmu nepatří');
    }

    public function testPlatformAdminReachesEveryTeam(): void
    {
        $identity = new Identity(
            userId: 1,
            email: 'spravce@example.com',
            displayName: 'Správce',
            isPlatformAdmin: true,
            rolesByTeam: [],
        );

        self::assertTrue($identity->hasRoleInTeam(99, Role::Admin));
        self::assertTrue($identity->isMemberOf(99));
    }

    public function testTokenPayloadRoundTrip(): void
    {
        $identity = new Identity(7, 'a@b.cz', 'Test', false, [5 => Role::Admin]);
        $restored = Identity::fromTokenPayload([
            'sub'           => 7,
            'email'         => 'a@b.cz',
            'name'          => 'Test',
            'platformAdmin' => false,
            'memberships'   => [['team' => 5, 'role' => 'admin']],
        ]);

        self::assertEquals($identity->toArray(), $restored->toArray());
    }

    public function testUnknownRoleInTokenIsIgnored(): void
    {
        // Kdyby se do tokenu dostala neznámá role, nesmí z ní vzniknout oprávnění.
        $identity = Identity::fromTokenPayload([
            'sub'         => 3,
            'email'       => 'x@y.cz',
            'name'        => 'X',
            'memberships' => [['team' => 1, 'role' => 'superuser']],
        ]);

        self::assertNull($identity->roleInTeam(1));
        self::assertFalse($identity->isMemberOf(1));
    }
}
