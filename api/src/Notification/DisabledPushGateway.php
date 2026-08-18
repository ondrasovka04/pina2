<?php

declare(strict_types=1);

namespace Pina\Notification;

/** Ve vývoji bez VAPID klíčů fronta zůstane k pozdějšímu odeslání. */
final class DisabledPushGateway implements PushGateway
{
    public function deliver(array $subscription, array $message): PushDelivery
    {
        return PushDelivery::failed('Web Push není nakonfigurovaný.');
    }
}
