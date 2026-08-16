<?php

declare(strict_types=1);

namespace Pina\Controller;

use Pina\Auth\Role;
use Pina\Http\ApiException;
use Pina\Http\Request;
use Pina\Http\Response;
use Pina\Service\TeamService;

/** Kontrola tvaru vstupu; autorizace v TeamService (TeamScope). */
final class TeamController
{
    public function __construct(private readonly TeamService $teams)
    {
    }

    public function myTeams(Request $request): Response
    {
        return Response::ok(['teams' => $this->teams->myTeams($request->identity())]);
    }

    public function platformOverview(Request $request): Response
    {
        return Response::ok(['clubs' => $this->teams->platformOverview($request->identity())]);
    }

    public function createClub(Request $request): Response
    {
        return Response::created([
            'club' => $this->teams->createClub($request->identity(), $request->string('name')),
        ]);
    }

    public function createTeam(Request $request): Response
    {
        return Response::created($this->teams->createTeam(
            $request->identity(),
            $request->routeId('club'),
            $request->string('name'),
            array_key_exists('color', $request->body) ? $this->hexColor($request) : null,
        ));
    }

    public function show(Request $request): Response
    {
        return Response::ok($this->teams->detail($request->identity(), $request->routeId('team')));
    }

    public function update(Request $request): Response
    {
        /** @var array{name?:string,color?:string|null} $changes */
        $changes = [];

        if (array_key_exists('name', $request->body)) {
            $changes['name'] = $request->string('name');
        }

        if (array_key_exists('color', $request->body)) {
            $changes['color'] = $this->hexColor($request);
        }

        return Response::ok($this->teams->update($request->identity(), $request->routeId('team'), $changes));
    }

    public function members(Request $request): Response
    {
        return Response::ok([
            'members' => $this->teams->members($request->identity(), $request->routeId('team')),
        ]);
    }

    public function invite(Request $request): Response
    {
        $email = mb_strtolower($request->string('email'));

        if (filter_var($email, FILTER_VALIDATE_EMAIL) === false) {
            throw ApiException::validation('E-mail nemá platný tvar.', ['field' => 'email']);
        }

        $invitation = $this->teams->invite(
            $request->identity(),
            $request->routeId('team'),
            $email,
            $this->role($request, 'role', Role::Player),
            $request->bool('sendEmail', true),
        );

        return Response::created(['invitation' => $invitation]);
    }

    public function resendInvitation(Request $request): Response
    {
        return Response::created([
            'invitation' => $this->teams->resendInvitation($request->identity(), $request->routeId('id')),
        ]);
    }

    public function sendActivationEmails(Request $request): Response
    {
        return Response::ok($this->teams->sendActivationEmails($request->identity(), $request->routeId('team')));
    }

    public function invitations(Request $request): Response
    {
        return Response::ok([
            'invitations' => $this->teams->invitations($request->identity(), $request->routeId('team')),
        ]);
    }

    public function revokeInvitation(Request $request): Response
    {
        $this->teams->revokeInvitation($request->identity(), $request->routeId('id'));

        return Response::ok(['revoked' => true]);
    }

    public function activationLink(Request $request): Response
    {
        return Response::created([
            'activation' => $this->teams->activationLink(
                $request->identity(),
                $request->routeId('id'),
                $request->bool('sendEmail', true),
            ),
        ]);
    }

    public function updateMembership(Request $request): Response
    {
        /** @var array{name?:string,role?:Role,jerseyNumber?:int|null,status?:string} $changes */
        $changes = [];

        if (array_key_exists('name', $request->body)) {
            $changes['name'] = $request->string('name');
        }

        if (array_key_exists('role', $request->body)) {
            $changes['role'] = $this->role($request, 'role', Role::Player);
        }

        if (array_key_exists('jerseyNumber', $request->body)) {
            $changes['jerseyNumber'] = $this->jerseyNumber($request);
        }

        if (array_key_exists('status', $request->body)) {
            $changes['status'] = $request->string('status');
        }

        return Response::ok(
            $this->teams->updateMembership($request->identity(), $request->routeId('id'), $changes),
        );
    }

    public function saveSettings(Request $request): Response
    {
        $settings = $this->teams->saveSettings($request->identity(), $request->routeId('team'), [
            'travelEnabled'              => $request->bool('travelEnabled'),
            'travelRateCzkKm'            => $this->rate($request),
            'travelRoundTrip'            => $request->bool('travelRoundTrip', true),
            'settlementPeriod'           => $request->optionalString('settlementPeriod') ?? 'none',
            'homeLocationId'             => $this->homeLocationId($request),
            'attendanceVisibleToPlayers' => $request->bool('attendanceVisibleToPlayers'),
            'balancesVisibleToPlayers'   => $request->bool('balancesVisibleToPlayers', true),
        ]);

        return Response::ok($settings);
    }

    /** Barva se ukládá jako #rrggbb; prázdná hodnota barvu zruší. */
    private function hexColor(Request $request): ?string
    {
        $value = $request->optionalString('color');

        if ($value === null) {
            return null;
        }

        if (preg_match('/^#[0-9a-fA-F]{6}$/', $value) !== 1) {
            throw ApiException::validation('Barva musí být ve tvaru #rrggbb.', ['field' => 'color']);
        }

        return mb_strtolower($value);
    }

    private function role(Request $request, string $key, Role $default): Role
    {
        $value = $request->optionalString($key);

        if ($value === null) {
            return $default;
        }

        return Role::tryFrom($value)
            ?? throw ApiException::validation('Neznámá role.', ['field' => $key]);
    }

    private function jerseyNumber(Request $request): ?int
    {
        if (($request->body['jerseyNumber'] ?? null) === null) {
            return null;
        }

        $number = $request->int('jerseyNumber');

        if ($number < 1 || $number > 99) {
            throw ApiException::validation('Číslo dresu musí být mezi 1 a 99.', ['field' => 'jerseyNumber']);
        }

        return $number;
    }

    private function homeLocationId(Request $request): ?int
    {
        if (($request->body['homeLocationId'] ?? null) === null) {
            return null;
        }

        return $request->int('homeLocationId');
    }

    /** Sazba za kilometr; sloupec je DECIMAL(5,2), víc než 999.99 se tam nevejde. */
    private function rate(Request $request): float
    {
        $value = $request->body['travelRateCzkKm'] ?? 5.0;

        if (!is_int($value) && !is_float($value) && !(is_string($value) && is_numeric($value))) {
            throw ApiException::validation('Sazba musí být číslo.', ['field' => 'travelRateCzkKm']);
        }

        $rate = round((float) $value, 2);

        if ($rate < 0 || $rate > 999.99) {
            throw ApiException::validation('Sazba musí být mezi 0 a 999,99 Kč/km.', ['field' => 'travelRateCzkKm']);
        }

        return $rate;
    }
}
