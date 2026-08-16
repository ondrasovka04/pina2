<?php

declare(strict_types=1);

namespace Pina\Http;

use Pina\Auth\TokenService;
use Pina\Support\Config;
use Pina\Support\Logger;
use Throwable;

/**
 * Zpracování požadavku: CORS → routa → autentizace → handler → odpověď.
 *
 * Autentizace probíhá na jednom místě, ne v každém endpointu zvlášť.
 * Autorizaci (kdo smí na který záznam) pak řeší TeamScope uvnitř handlerů.
 */
final class Kernel
{
    public function __construct(
        private readonly Router $router,
        private readonly TokenService $tokens,
        private readonly Logger $logger,
    ) {
    }

    public function handle(Request $request): Response
    {
        try {
            if ($request->method === 'OPTIONS') {
                return new Response(204, null, $this->corsHeaders());
            }

            $route = $this->router->match($request);

            if ($route['auth']) {
                $token = $request->bearerToken();

                if ($token === null) {
                    throw ApiException::unauthenticated();
                }

                $request->identity = $this->tokens->verify($token);
            }

            $response = ($route['handler'])($request);

            return new Response(
                $response->status,
                $response->data,
                [...$this->corsHeaders(), ...$response->headers],
                $response->cookie,
            );
        } catch (ApiException $e) {
            return new Response(
                $e->status,
                Response::error($e)->data,
                $this->corsHeaders(),
            );
        } catch (Throwable $e) {
            // Na hostingu je log_errors vypnutý, proto se loguje vlastními silami.
            $this->logger->error($e, [
                'method' => $request->method,
                'path'   => $request->path,
                'user'   => $request->identity?->userId,
            ]);

            $details = Config::isDebug()
                ? ['exception' => $e::class, 'message' => $e->getMessage(), 'file' => $e->getFile() . ':' . $e->getLine()]
                : [];

            return new Response(500, [
                'error' => array_filter([
                    'code'    => 'INTERNAL_ERROR',
                    'message' => 'Došlo k neočekávané chybě. Zkuste to prosím znovu.',
                    'details' => $details === [] ? null : $details,
                ], static fn (mixed $v): bool => $v !== null),
            ], $this->corsHeaders());
        }
    }

    /**
     * Povolen je jen konkrétní původ, ne '*' jako ve staré verzi — jinak by
     * jakákoli stránka mohla volat API jménem přihlášeného uživatele.
     *
     * @return array<string,string>
     */
    private function corsHeaders(): array
    {
        return [
            'Access-Control-Allow-Origin'      => Config::get('APP_URL'),
            'Access-Control-Allow-Credentials' => 'true',
            'Access-Control-Allow-Headers'     => 'Content-Type, Authorization',
            'Access-Control-Allow-Methods'     => 'GET, POST, PUT, PATCH, DELETE, OPTIONS',
            'Vary'                             => 'Origin',
        ];
    }
}
