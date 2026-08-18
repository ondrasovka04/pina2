<?php

declare(strict_types=1);

namespace Pina\Notification;

use JsonException;
use Minishlink\WebPush\Subscription;
use Minishlink\WebPush\WebPush;

/** Tenký adaptér kolem minishlink/web-push, aby odesílání šlo testovat bez sítě. */
final class WebPushGateway implements PushGateway
{
    private readonly WebPush $client;

    /** Výchozích 30 s na jedno doručení by na hostingu vyčerpalo limit běhu skriptu. */
    private const TIMEOUT_SECONDS = 8;

    public function __construct(string $subject, string $publicKey, string $privateKey)
    {
        $this->client = new WebPush(
            [
                'VAPID' => [
                    'subject'    => $subject,
                    'publicKey'  => $publicKey,
                    'privateKey' => $privateKey,
                ],
            ],
            ['TTL' => 86_400, 'urgency' => 'normal'],
            self::TIMEOUT_SECONDS,
        );
    }

    /**
     * @param array{endpoint:string,p256dh:string,auth:string,contentEncoding:string} $subscription
     * @param array{title:string,body:string,link:string}                             $message
     *
     * @throws JsonException
     */
    public function deliver(array $subscription, array $message): PushDelivery
    {
        $target = Subscription::create([
            'endpoint'        => $subscription['endpoint'],
            'publicKey'       => $subscription['p256dh'],
            'authToken'       => $subscription['auth'],
            'contentEncoding' => $subscription['contentEncoding'],
        ]);

        $report = $this->client->sendOneNotification(
            $target,
            json_encode($message, JSON_THROW_ON_ERROR | JSON_UNESCAPED_UNICODE),
        );

        if ($report->isSuccess()) {
            return PushDelivery::delivered();
        }

        if ($report->isSubscriptionExpired()) {
            return PushDelivery::expired($report->getReason());
        }

        return PushDelivery::failed($report->getReason());
    }
}
