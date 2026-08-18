<?php

declare(strict_types=1);

namespace Pina\Controller;

use Pina\Http\ApiException;
use Pina\Http\Request;
use Pina\Http\Response;
use Pina\Service\NotificationService;

final class NotificationController
{
    public function __construct(
        private readonly NotificationService $notifications,
        private readonly string $cronToken,
    ) {
    }

    public function settings(Request $request): Response
    {
        return Response::ok($this->notifications->settings($request->identity()));
    }

    public function subscribe(Request $request): Response
    {
        $this->notifications->subscribe($request->identity(), [
            'endpoint'        => $request->string('endpoint'),
            'p256dh'          => $request->string('p256dh'),
            'auth'            => $request->string('auth'),
            'contentEncoding' => $request->string('contentEncoding', 'aes128gcm'),
            'deviceId'        => $request->string('deviceId'),
        ]);

        return Response::created($this->notifications->settings($request->identity()));
    }

    public function unsubscribe(Request $request): Response
    {
        $this->notifications->unsubscribe($request->identity(), $request->string('endpoint'));

        return Response::noContent();
    }

    public function preferences(Request $request): Response
    {
        $values = [];
        foreach (['eventReminder', 'offenceBatch'] as $key) {
            if (!array_key_exists($key, $request->body) || !is_bool($request->body[$key])) {
                throw ApiException::validation('Všechny volby musí být ano, nebo ne.', ['field' => $key]);
            }
            $values[$key] = $request->body[$key];
        }

        return Response::ok(['preferences' => $this->notifications->savePreferences($request->identity(), $values)]);
    }

    public function sendQueue(Request $request): Response
    {
        $this->assertCron($request);
        $reminders = $this->notifications->enqueueEventReminders();

        return Response::ok([
            'eventRemindersCreated' => $reminders,
            'delivery'              => $this->notifications->flush(limit: 50),
        ]);
    }

    private function assertCron(Request $request): void
    {
        $given = $request->queryString('token');
        if ($this->cronToken === '' || $given === null || !hash_equals($this->cronToken, $given)) {
            throw ApiException::notFound();
        }
    }
}
