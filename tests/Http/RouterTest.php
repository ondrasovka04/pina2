<?php

declare(strict_types=1);

namespace Pina\Tests\Http;

use Pina\Http\ApiException;
use Pina\Http\Request;
use Pina\Http\Response;
use Pina\Http\Router;
use PHPUnit\Framework\TestCase;

final class RouterTest extends TestCase
{
    private function request(string $method, string $path): Request
    {
        return new Request($method, $path, [], [], [], '127.0.0.1');
    }

    public function testMatchesStaticRoute(): void
    {
        $router = new Router();
        $router->get('/api/v1/me', static fn (): Response => Response::ok(['ok' => true]));

        $route = $router->match($this->request('GET', '/api/v1/me'));

        self::assertTrue($route['auth']);
    }

    public function testExtractsRouteParameters(): void
    {
        $router = new Router();
        $router->get('/api/v1/seasons/{season}/offences/{id}', static fn (): Response => Response::noContent());

        $request = $this->request('GET', '/api/v1/seasons/12/offences/345');
        $router->match($request);

        self::assertSame(['season' => '12', 'id' => '345'], $request->routeParams);
        self::assertSame(12, $request->routeId('season'));
    }

    public function testNonNumericRouteIdIsRejected(): void
    {
        // Ochrana proti pokusu podstrčit do ID něco jiného než číslo.
        $router = new Router();
        $router->get('/api/v1/seasons/{season}', static fn (): Response => Response::noContent());

        $request = $this->request('GET', '/api/v1/seasons/1%20OR%201=1');
        $router->match($request);

        $this->expectException(ApiException::class);
        $request->routeId('season');
    }

    public function testUnknownPathIsNotFound(): void
    {
        $router = new Router();
        $router->get('/api/v1/me', static fn (): Response => Response::noContent());

        try {
            $router->match($this->request('GET', '/api/v1/neexistuje'));
            self::fail('neznámá cesta má vracet 404');
        } catch (ApiException $e) {
            self::assertSame(404, $e->status);
        }
    }

    public function testKnownPathWithWrongMethodIsMethodNotAllowed(): void
    {
        $router = new Router();
        $router->get('/api/v1/me', static fn (): Response => Response::noContent());

        try {
            $router->match($this->request('DELETE', '/api/v1/me'));
            self::fail('špatná metoda má vracet 405');
        } catch (ApiException $e) {
            self::assertSame(405, $e->status);
            self::assertSame('METHOD_NOT_ALLOWED', $e->errorCode);
        }
    }

    public function testPublicRouteIsMarked(): void
    {
        $router = new Router();
        $router->post('/api/v1/auth/login', static fn (): Response => Response::noContent(), auth: false);

        self::assertFalse($router->match($this->request('POST', '/api/v1/auth/login'))['auth']);
    }

    public function testRouteParameterDoesNotSpanSlashes(): void
    {
        // {id} nesmí pohltit lomítko, jinak by /seasons/1/offences odpovídalo /seasons/{id}
        $router = new Router();
        $router->get('/api/v1/seasons/{id}', static fn (): Response => Response::noContent());

        $this->expectException(ApiException::class);
        $router->match($this->request('GET', '/api/v1/seasons/1/offences'));
    }
}
