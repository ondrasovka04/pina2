<?php

declare(strict_types=1);

namespace Pina\Http;

/**
 * Router s parametry v cestě ve tvaru {name}.
 *
 * Náhrada za 45 samostatných PHP souborů staré verze, kde každý znovu řešil
 * metodu, autorizaci i připojení k databázi.
 */
final class Router
{
    /** @var list<array{method:string,pattern:string,regex:string,params:list<string>,handler:callable,auth:bool}> */
    private array $routes = [];

    public function get(string $pattern, callable $handler, bool $auth = true): void
    {
        $this->add('GET', $pattern, $handler, $auth);
    }

    public function post(string $pattern, callable $handler, bool $auth = true): void
    {
        $this->add('POST', $pattern, $handler, $auth);
    }

    public function put(string $pattern, callable $handler, bool $auth = true): void
    {
        $this->add('PUT', $pattern, $handler, $auth);
    }

    public function patch(string $pattern, callable $handler, bool $auth = true): void
    {
        $this->add('PATCH', $pattern, $handler, $auth);
    }

    public function delete(string $pattern, callable $handler, bool $auth = true): void
    {
        $this->add('DELETE', $pattern, $handler, $auth);
    }

    /**
     * Najde odpovídající routu a doplní parametry do požadavku.
     *
     * @return array{handler:callable,auth:bool}
     */
    public function match(Request $request): array
    {
        $pathMatched = false;

        foreach ($this->routes as $route) {
            if (preg_match($route['regex'], $request->path, $matches) !== 1) {
                continue;
            }

            $pathMatched = true;

            if ($route['method'] !== $request->method) {
                continue;
            }

            foreach ($route['params'] as $index => $name) {
                $request->routeParams[$name] = $matches[$index + 1];
            }

            return ['handler' => $route['handler'], 'auth' => $route['auth']];
        }

        // Existující cesta se špatnou metodou má vracet 405, ne 404 —
        // pomáhá to při ladění klienta.
        if ($pathMatched) {
            throw new ApiException(405, 'METHOD_NOT_ALLOWED', 'Tato metoda není na daném endpointu povolena.');
        }

        throw ApiException::notFound('Endpoint neexistuje.');
    }

    private function add(string $method, string $pattern, callable $handler, bool $auth): void
    {
        $params = [];
        $regex  = preg_replace_callback(
            '/\{(\w+)\}/',
            static function (array $m) use (&$params): string {
                $params[] = $m[1];

                return '([^/]+)';
            },
            $pattern,
        );

        $this->routes[] = [
            'method'  => $method,
            'pattern' => $pattern,
            'regex'   => '#^' . $regex . '$#',
            'params'  => $params,
            'handler' => $handler,
            'auth'    => $auth,
        ];
    }
}
