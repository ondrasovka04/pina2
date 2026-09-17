<?php

declare(strict_types=1);

namespace Pina\Http;

use Pina\Auth\TokenService;
use Pina\Support\Config;
use Pina\Support\Logger;
use Throwable;

/** Centrální autentizace (ne v každém endpointu). Autorizace v TeamScope. */
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
                $supportTeam       = $request->header('x-support-team');
                if ($supportTeam !== null) {
                    if (!ctype_digit($supportTeam) || (int) $supportTeam <= 0) {
                        throw ApiException::validation('Neplatné družstvo pro režim podpory.');
                    }
                    $request->identity = $this->tokens->forSupport($request->identity, (int) $supportTeam);
                }
            }

            $response = ($route['handler'])($request);

            return new Response(
                $response->status,
                $response->data,
                [...$this->corsHeaders(), ...$response->headers],
                $response->cookie,
                $response->rawBody,
                $response->contentType,
            );
        } catch (ApiException $e) {
            return new Response(
                $e->status,
                Response::error($e)->data,
                $this->corsHeaders(),
            );
        } catch (Throwable $e) {
            // Na hostingu je log_errors vypnutý — vlastní logging.
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
     * Konkrétní origin, ne '*' (brání CSRF na přihlášeného uživatele).
     *
     * @return array<string,string>
     */
    private function corsHeaders(): array
    {
        return [
            'Access-Control-Allow-Origin'      => Config::get('APP_URL'),
            'Access-Control-Allow-Credentials' => 'true',
            'Access-Control-Allow-Headers'     => 'Content-Type, Authorization, X-Support-Team',
            'Access-Control-Allow-Methods'     => 'GET, POST, PUT, PATCH, DELETE, OPTIONS',
            'Vary'                             => 'Origin',
        ];
    }
}
