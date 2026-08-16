<?php

declare(strict_types=1);

namespace Pina\Controller;

use Pina\Auth\AuthService;
use Pina\Auth\PasswordResetService;
use Pina\Auth\TokenService;
use Pina\Http\ApiException;
use Pina\Http\Request;
use Pina\Http\Response;
use Pina\Support\Config;

final class AuthController
{
    private const REFRESH_COOKIE = 'pina_refresh';

    public function __construct(
        private readonly AuthService $auth,
        private readonly TokenService $tokens,
        private readonly PasswordResetService $resets,
    ) {
    }

    public function login(Request $request): Response
    {
        $result = $this->auth->login(
            $request->string('email'),
            $request->string('password'),
            $request->header('user-agent'),
            $request->ip,
        );

        return Response::ok([
            'accessToken' => $result['accessToken'],
            'expiresIn'   => $result['expiresIn'],
            'user'        => $result['user'],
        ])->withCookie($this->refreshCookie($result['refreshToken']));
    }

    public function refresh(Request $request): Response
    {
        $token = $_COOKIE[self::REFRESH_COOKIE] ?? null;

        if (!is_string($token) || $token === '') {
            throw ApiException::unauthenticated();
        }

        $pair = $this->tokens->refresh($token, $request->header('user-agent'), $request->ip);

        return Response::ok([
            'accessToken' => $pair['accessToken'],
            'expiresIn'   => $pair['expiresIn'],
        ])->withCookie($this->refreshCookie($pair['refreshToken']));
    }

    public function logout(Request $request): Response
    {
        $token = $_COOKIE[self::REFRESH_COOKIE] ?? null;

        if (is_string($token) && $token !== '') {
            $this->tokens->revoke($token);
        }

        return Response::noContent()->withCookie($this->refreshCookie('', expired: true));
    }

    /** Logout všude (ztráta telefonu). */
    public function logoutEverywhere(Request $request): Response
    {
        $userId = $request->identity()->userId;

        $this->tokens->revokeAllForUser($userId);
        $this->tokens->invalidateAccessTokens($userId);

        return Response::noContent()->withCookie($this->refreshCookie('', expired: true));
    }

    public function acceptInvitation(Request $request): Response
    {
        $userId = $this->auth->acceptInvitation(
            $request->string('token'),
            $request->string('password'),
            $request->string('name'),
        );

        $pair = $this->tokens->issue($userId, $request->header('user-agent'), $request->ip);

        return Response::created([
            'accessToken' => $pair['accessToken'],
            'expiresIn'   => $pair['expiresIn'],
            'user'        => $this->auth->userPayload($userId),
        ])->withCookie($this->refreshCookie($pair['refreshToken']));
    }

    /** Odpověď je vždy stejná — jinak by šlo zjišťovat, kdo je v aplikaci registrovaný. */
    public function forgotPassword(Request $request): Response
    {
        $this->resets->request($request->string('email'), $request->ip);

        return Response::ok(['sent' => true]);
    }

    /** Nové heslo z odkazu. Rovnou přihlašuje, ať uživatel nepíše heslo dvakrát. */
    public function resetPassword(Request $request): Response
    {
        $userId = $this->resets->complete($request->string('token'), $request->string('password'));

        $pair = $this->tokens->issue($userId, $request->header('user-agent'), $request->ip);

        return Response::ok([
            'accessToken' => $pair['accessToken'],
            'expiresIn'   => $pair['expiresIn'],
            'user'        => $this->auth->userPayload($userId),
        ])->withCookie($this->refreshCookie($pair['refreshToken']));
    }

    public function changePassword(Request $request): Response
    {
        $this->auth->changePassword(
            $request->identity()->userId,
            $request->string('currentPassword'),
            $request->string('newPassword'),
        );

        return Response::noContent()->withCookie($this->refreshCookie('', expired: true));
    }

    public function me(Request $request): Response
    {
        return Response::ok($this->auth->userPayload($request->identity()->userId));
    }

    /** HttpOnly cookie (XSS ochrana) + SameSite=Strict (CSRF ochrana). */
    private function refreshCookie(string $value, bool $expired = false): string
    {
        $parts = [
            self::REFRESH_COOKIE . '=' . $value,
            'Path=/api/v1/auth',
            'HttpOnly',
            'SameSite=Strict',
            'Max-Age=' . ($expired ? 0 : Config::int('JWT_REFRESH_TTL', 2592000)),
        ];

        if (Config::isProduction()) {
            $parts[] = 'Secure';
        }

        return implode('; ', $parts);
    }
}
