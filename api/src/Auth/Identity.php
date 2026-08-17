<?php

declare(strict_types=1);

namespace Pina\Auth;

/**
 * Přihlášený uživatel a role v jednotlivých týmech.
 * Z JWT pro rychlost, ale ověřuje se proti DB (token je nápověda, ne důkaz).
 */
final class Identity
{
    /** @param array<int,Role> $rolesByTeam klíč = team_id */
    public function __construct(
        public readonly int $userId,
        public readonly string $email,
        public readonly string $displayName,
        public readonly bool $isPlatformAdmin,
        private readonly array $rolesByTeam,
    ) {
    }

    public function roleInTeam(int $teamId): ?Role
    {
        return $this->rolesByTeam[$teamId] ?? null;
    }

    public function hasRoleInTeam(int $teamId, Role $required): bool
    {
        if ($this->isPlatformAdmin) {
            return true;
        }

        return $this->roleInTeam($teamId)?->allows($required) ?? false;
    }

    public function isMemberOf(int $teamId): bool
    {
        return $this->isPlatformAdmin || isset($this->rolesByTeam[$teamId]);
    }

    /** @return array<string,mixed> pro payload tokenu a odpověď /me */
    public function toArray(): array
    {
        $memberships = [];
        foreach ($this->rolesByTeam as $teamId => $role) {
            $memberships[] = ['team' => $teamId, 'role' => $role->value];
        }

        return [
            'id'             => $this->userId,
            'email'          => $this->email,
            'name'           => $this->displayName,
            'platformAdmin'  => $this->isPlatformAdmin,
            'memberships'    => $memberships,
        ];
    }

    /** @param array<string,mixed> $payload */
    public static function fromTokenPayload(array $payload): self
    {
        $roles = [];
        /** @var list<array{team:int,role:string}> $memberships */
        $memberships = $payload['memberships'] ?? [];
        foreach ($memberships as $membership) {
            $role = Role::tryFrom((string) $membership['role']);
            if ($role instanceof Role) {
                $roles[(int) $membership['team']] = $role;
            }
        }

        return new self(
            userId:          (int) $payload['sub'],
            email:           (string) $payload['email'],
            displayName:     (string) $payload['name'],
            isPlatformAdmin: (bool) ($payload['platformAdmin'] ?? false),
            rolesByTeam:     $roles,
        );
    }
}
