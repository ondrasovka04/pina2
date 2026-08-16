<?php

declare(strict_types=1);

namespace Pina;

use Pina\Auth\AuthService;
use Pina\Auth\PasswordService;
use Pina\Auth\TeamScope;
use Pina\Auth\TokenService;
use Pina\Controller\AuthController;
use Pina\Http\Kernel;
use Pina\Http\RateLimiter;
use Pina\Http\Router;
use Pina\Support\Config;
use Pina\Support\Database;
use Pina\Support\Logger;

/**
 * Složení aplikace. Na tenhle rozsah nemá smysl tahat DI kontejner —
 * závislostí je pár a jsou přehledné.
 */
final class App
{
    public readonly Database $db;
    public readonly Logger $logger;
    public readonly TokenService $tokens;
    public readonly TeamScope $scope;

    public function __construct(string $rootPath)
    {
        Config::load($rootPath);

        $this->db     = new Database();
        $this->logger = new Logger($rootPath . '/storage/logs');
        $this->tokens = new TokenService($this->db);
        $this->scope  = new TeamScope($this->db);
    }

    public function kernel(): Kernel
    {
        return new Kernel($this->routes(), $this->tokens, $this->logger);
    }

    private function routes(): Router
    {
        $router    = new Router();
        $passwords = new PasswordService();
        $limiter   = new RateLimiter($this->db);
        $auth      = new AuthService($this->db, $this->tokens, $passwords, $limiter);
        $authCtrl  = new AuthController($auth, $this->tokens);

        // Veřejné (auth: false)
        $router->post('/api/v1/auth/login', $authCtrl->login(...), auth: false);
        $router->post('/api/v1/auth/refresh', $authCtrl->refresh(...), auth: false);
        $router->post('/api/v1/auth/logout', $authCtrl->logout(...), auth: false);
        $router->post('/api/v1/invitations/accept', $authCtrl->acceptInvitation(...), auth: false);

        // Vyžadují přihlášení
        $router->get('/api/v1/me', $authCtrl->me(...));
        $router->post('/api/v1/auth/logout-everywhere', $authCtrl->logoutEverywhere(...));
        $router->post('/api/v1/auth/password', $authCtrl->changePassword(...));

        return $router;
    }
}
