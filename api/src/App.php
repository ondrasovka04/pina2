<?php

declare(strict_types=1);

namespace Pina;

use Pina\Auth\AuthService;
use Pina\Auth\PasswordResetService;
use Pina\Auth\PasswordService;
use Pina\Auth\TeamScope;
use Pina\Auth\TokenService;
use Pina\Controller\AuthController;
use Pina\Controller\CalendarFeedController;
use Pina\Controller\EventController;
use Pina\Controller\FinanceController;
use Pina\Controller\LocationController;
use Pina\Controller\NotificationController;
use Pina\Controller\OffenceController;
use Pina\Controller\OffenceTypeController;
use Pina\Controller\SeasonController;
use Pina\Controller\TeamController;
use Pina\Http\Kernel;
use Pina\Http\RateLimiter;
use Pina\Http\Router;
use Pina\Mail\InvitationMail;
use Pina\Mail\PasswordResetMail;
use Pina\Mail\SmtpMailer;
use Pina\Notification\DisabledPushGateway;
use Pina\Notification\WebPushGateway;
use Pina\Service\CalendarFeedService;
use Pina\Service\EventService;
use Pina\Service\FinanceService;
use Pina\Service\LocationService;
use Pina\Service\NotificationService;
use Pina\Service\OffenceService;
use Pina\Service\OffenceTypeService;
use Pina\Service\SeasonService;
use Pina\Service\TeamService;
use Pina\Support\Config;
use Pina\Support\Database;
use Pina\Support\IcsCalendar;
use Pina\Support\Logger;

/** Složení aplikace. Bez DI kontejneru — závislostí je málo a jsou přehledné. */
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
        $resets    = new PasswordResetService(
            $this->db,
            $this->tokens,
            $passwords,
            new PasswordResetMail(SmtpMailer::fromConfig($this->logger), Config::get('APP_URL', '')),
        );
        $notifications = $this->notificationService();
        $authCtrl      = new AuthController($auth, $this->tokens, $resets, $notifications);
        $calendarCtrl  = new CalendarFeedController(
            new CalendarFeedService($this->db, $this->scope, new IcsCalendar()),
        );
        $notificationCtrl = new NotificationController($notifications, Config::get('CRON_TOKEN', ''));

        // Veřejné (auth: false)
        $router->post('/api/v1/auth/login', $authCtrl->login(...), auth: false);
        $router->post('/api/v1/auth/refresh', $authCtrl->refresh(...), auth: false);
        $router->post('/api/v1/auth/logout', $authCtrl->logout(...), auth: false);
        $router->post('/api/v1/invitations/accept', $authCtrl->acceptInvitation(...), auth: false);
        $router->post('/api/v1/auth/password/forgot', $authCtrl->forgotPassword(...), auth: false);
        $router->post('/api/v1/auth/password/reset', $authCtrl->resetPassword(...), auth: false);
        $router->get('/api/v1/calendar/{token}.ics', $calendarCtrl->show(...), auth: false);
        $router->post('/api/v1/cron/notifications/send', $notificationCtrl->sendQueue(...), auth: false);

        // Vyžadují přihlášení
        $router->get('/api/v1/me', $authCtrl->me(...));
        $router->post('/api/v1/auth/logout-everywhere', $authCtrl->logoutEverywhere(...));
        $router->post('/api/v1/auth/password', $authCtrl->changePassword(...));
        $router->get('/api/v1/me/calendar-feeds', $calendarCtrl->index(...));
        $router->post('/api/v1/seasons/{season}/calendar-feed', $calendarCtrl->issue(...));
        $router->delete('/api/v1/calendar-feeds/{id}', $calendarCtrl->revoke(...));
        $router->get('/api/v1/me/notifications/settings', $notificationCtrl->settings(...));
        $router->put('/api/v1/me/notifications/preferences', $notificationCtrl->preferences(...));
        $router->post('/api/v1/push/subscribe', $notificationCtrl->subscribe(...));
        $router->post('/api/v1/push/unsubscribe', $notificationCtrl->unsubscribe(...));

        $this->teamRoutes($router);
        $this->offenceRoutes($router, $notifications);
        $this->eventRoutes($router);
        $this->financeRoutes($router);

        return $router;
    }

    /** Družstva, členové, sezóny a soupisky. */
    private function teamRoutes(Router $router): void
    {
        $mails      = new InvitationMail(SmtpMailer::fromConfig($this->logger), Config::get('APP_URL', ''));
        $teamCtrl   = new TeamController(new TeamService($this->db, $this->scope, $this->tokens, $mails));
        $seasonCtrl = new SeasonController(new SeasonService($this->db, $this->scope));

        $router->get('/api/v1/admin/clubs', $teamCtrl->platformOverview(...));
        $router->post('/api/v1/clubs', $teamCtrl->createClub(...));
        $router->post('/api/v1/clubs/{club}/teams', $teamCtrl->createTeam(...));

        $router->get('/api/v1/me/teams', $teamCtrl->myTeams(...));
        $router->get('/api/v1/teams/{team}', $teamCtrl->show(...));
        $router->patch('/api/v1/teams/{team}', $teamCtrl->update(...));
        $router->get('/api/v1/teams/{team}/members', $teamCtrl->members(...));
        $router->post('/api/v1/teams/{team}/members', $teamCtrl->invite(...));
        $router->get('/api/v1/teams/{team}/invitations', $teamCtrl->invitations(...));
        $router->delete('/api/v1/invitations/{id}', $teamCtrl->revokeInvitation(...));
        $router->post('/api/v1/invitations/{id}/resend', $teamCtrl->resendInvitation(...));
        $router->post('/api/v1/teams/{team}/activation-emails', $teamCtrl->sendActivationEmails(...));
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
    private function offenceRoutes(Router $router, NotificationService $notifications): void
    {
        $typeCtrl    = new OffenceTypeController(new OffenceTypeService($this->db, $this->scope));
        $offenceCtrl = new OffenceController(new OffenceService($this->db, $this->scope, notifications: $notifications));

        $router->get('/api/v1/seasons/{season}/offence-types', $typeCtrl->index(...));
        $router->post('/api/v1/seasons/{season}/offence-types', $typeCtrl->store(...));
        $router->put('/api/v1/seasons/{season}/offence-types/order', $typeCtrl->reorder(...));
        $router->post('/api/v1/seasons/{season}/offence-types/copy-from/{source}', $typeCtrl->copyFrom(...));
        $router->patch('/api/v1/offence-types/{id}', $typeCtrl->update(...));
        $router->delete('/api/v1/offence-types/{id}', $typeCtrl->archive(...));

        $router->get('/api/v1/seasons/{season}/offences', $offenceCtrl->index(...));
        $router->get('/api/v1/seasons/{season}/offence-batches', $offenceCtrl->batches(...));
        $router->post('/api/v1/seasons/{season}/offence-batches', $offenceCtrl->createBatch(...));
        $router->get('/api/v1/seasons/{season}/balances', $offenceCtrl->balances(...));
        $router->get('/api/v1/offence-batches/{id}', $offenceCtrl->showBatch(...));
        $router->post('/api/v1/offence-batches/{id}/void', $offenceCtrl->voidBatch(...));
        $router->post('/api/v1/offences/{id}/void', $offenceCtrl->voidRecord(...));
    }

    /** Kalendář, docházka a místa konání. */
    private function eventRoutes(Router $router): void
    {
        $eventCtrl    = new EventController(new EventService($this->db, $this->scope));
        $locationCtrl = new LocationController(new LocationService($this->db, $this->scope));

        $router->get('/api/v1/seasons/{season}/events', $eventCtrl->index(...));
        $router->post('/api/v1/seasons/{season}/events', $eventCtrl->store(...));
        $router->get('/api/v1/seasons/{season}/event-series', $eventCtrl->series(...));
        $router->post('/api/v1/seasons/{season}/event-series', $eventCtrl->storeSeries(...));
        $router->get('/api/v1/seasons/{season}/attendance', $eventCtrl->summary(...));

        $router->get('/api/v1/events/{id}', $eventCtrl->show(...));
        $router->patch('/api/v1/events/{id}', $eventCtrl->update(...));
        $router->post('/api/v1/events/{id}/cancel', $eventCtrl->cancel(...));
        $router->post('/api/v1/events/{id}/restore', $eventCtrl->restore(...));
        $router->delete('/api/v1/events/{id}', $eventCtrl->delete(...));
        $router->put('/api/v1/events/{id}/rsvp', $eventCtrl->saveRsvp(...));
        $router->put('/api/v1/events/{id}/attendance', $eventCtrl->saveAttendance(...));
        $router->put('/api/v1/events/{id}/nominations', $eventCtrl->saveNominations(...));
        $router->patch('/api/v1/event-series/{id}', $eventCtrl->updateSeries(...));
        $router->delete('/api/v1/event-series/{id}', $eventCtrl->deleteSeries(...));

        $router->get('/api/v1/clubs/{club}/locations', $locationCtrl->index(...));
        $router->post('/api/v1/clubs/{club}/locations', $locationCtrl->store(...));
        $router->patch('/api/v1/locations/{id}', $locationCtrl->update(...));
        $router->delete('/api/v1/locations/{id}', $locationCtrl->delete(...));
    }

    /** Platby, QR a cesťáky. */
    private function financeRoutes(Router $router): void
    {
        $controller = new FinanceController(new FinanceService($this->db, $this->scope));

        $router->get('/api/v1/seasons/{season}/payments', $controller->payments(...));
        $router->post('/api/v1/seasons/{season}/payments', $controller->createPayment(...));
        $router->post('/api/v1/payments/{id}/void', $controller->voidPayment(...));
        $router->get('/api/v1/seasons/{season}/travel-claims', $controller->travelClaims(...));
        $router->post('/api/v1/seasons/{season}/travel-claims', $controller->createTravelClaim(...));
        $router->post('/api/v1/seasons/{season}/travel-claims/sync', $controller->syncTravelClaims(...));
        $router->post('/api/v1/travel-claims/{id}/void', $controller->voidTravelClaim(...));
        $router->get('/api/v1/memberships/{id}/payment-qr', $controller->paymentQr(...));
    }

    private function notificationService(): NotificationService
    {
        $publicKey  = Config::get('VAPID_PUBLIC_KEY', '');
        $privateKey = Config::get('VAPID_PRIVATE_KEY', '');
        $gateway    = $publicKey !== '' && $privateKey !== ''
            ? new WebPushGateway(Config::get('VAPID_SUBJECT', 'mailto:webmaster@pinaprosek.eu'), $publicKey, $privateKey)
            : new DisabledPushGateway();

        return new NotificationService($this->db, $gateway, $publicKey);
    }
}
