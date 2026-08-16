<?php

declare(strict_types=1);

namespace Pina;

use Pina\Auth\AuthService;
use Pina\Auth\PasswordService;
use Pina\Auth\TeamScope;
use Pina\Auth\TokenService;
use Pina\Controller\AuthController;
use Pina\Controller\OffenceController;
use Pina\Controller\OffenceTypeController;
use Pina\Controller\SeasonController;
use Pina\Controller\TeamController;
use Pina\Http\Kernel;
use Pina\Http\RateLimiter;
use Pina\Http\Router;
use Pina\Service\OffenceService;
use Pina\Service\OffenceTypeService;
use Pina\Service\SeasonService;
use Pina\Service\TeamService;
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

        $this->teamRoutes($router);
        $this->offenceRoutes($router);

        return $router;
    }

    /** Družstva, členové, sezóny a soupisky. */
    private function teamRoutes(Router $router): void
    {
        $teamCtrl   = new TeamController(new TeamService($this->db, $this->scope, $this->tokens));
        $seasonCtrl = new SeasonController(new SeasonService($this->db, $this->scope));

        $router->post('/api/v1/clubs', $teamCtrl->createClub(...));
        $router->post('/api/v1/clubs/{club}/teams', $teamCtrl->createTeam(...));

        $router->get('/api/v1/me/teams', $teamCtrl->myTeams(...));
        $router->get('/api/v1/teams/{team}', $teamCtrl->show(...));
        $router->patch('/api/v1/teams/{team}', $teamCtrl->update(...));
        $router->get('/api/v1/teams/{team}/members', $teamCtrl->members(...));
        $router->post('/api/v1/teams/{team}/members', $teamCtrl->invite(...));
        $router->get('/api/v1/teams/{team}/invitations', $teamCtrl->invitations(...));
        $router->delete('/api/v1/invitations/{id}', $teamCtrl->revokeInvitation(...));
        $router->put('/api/v1/teams/{team}/settings', $teamCtrl->saveSettings(...));
        $router->patch('/api/v1/memberships/{id}', $teamCtrl->updateMembership(...));
        $router->post('/api/v1/memberships/{id}/activation', $teamCtrl->activationLink(...));

        $router->get('/api/v1/teams/{team}/seasons', $seasonCtrl->index(...));
        $router->post('/api/v1/teams/{team}/seasons', $seasonCtrl->create(...));
        $router->patch('/api/v1/seasons/{id}', $seasonCtrl->update(...));
        $router->post('/api/v1/seasons/{id}/close', $seasonCtrl->close(...));
        $router->get('/api/v1/seasons/{id}/roster', $seasonCtrl->roster(...));
        $router->put('/api/v1/seasons/{id}/roster', $seasonCtrl->saveRoster(...));
    }

    /** Sazebník a zápisy prohřešků — nejpoužívanější část aplikace. */
    private function offenceRoutes(Router $router): void
    {
        $typeCtrl    = new OffenceTypeController(new OffenceTypeService($this->db, $this->scope));
        $offenceCtrl = new OffenceController(new OffenceService($this->db, $this->scope));

        $router->get('/api/v1/seasons/{season}/offence-types', $typeCtrl->index(...));
        $router->post('/api/v1/seasons/{season}/offence-types', $typeCtrl->store(...));
        $router->put('/api/v1/seasons/{season}/offence-types/order', $typeCtrl->reorder(...));
        $router->post('/api/v1/seasons/{season}/offence-types/copy-from/{source}', $typeCtrl->copyFrom(...));
        $router->patch('/api/v1/offence-types/{id}', $typeCtrl->update(...));
        $router->delete('/api/v1/offence-types/{id}', $typeCtrl->archive(...));

        $router->get('/api/v1/seasons/{season}/offences', $offenceCtrl->index(...));
        $router->post('/api/v1/seasons/{season}/offence-batches', $offenceCtrl->createBatch(...));
        $router->get('/api/v1/seasons/{season}/balances', $offenceCtrl->balances(...));
        $router->get('/api/v1/offence-batches/{id}', $offenceCtrl->showBatch(...));
        $router->post('/api/v1/offence-batches/{id}/void', $offenceCtrl->voidBatch(...));
        $router->post('/api/v1/offences/{id}/void', $offenceCtrl->voidRecord(...));
    }
}
