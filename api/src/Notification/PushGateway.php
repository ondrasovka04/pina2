<?php

declare(strict_types=1);

namespace Pina\Notification;

interface PushGateway
{
    /**
     * @param array{endpoint:string,p256dh:string,auth:string,contentEncoding:string} $subscription
     * @param array{title:string,body:string,link:string}                             $message
     */
    public function deliver(array $subscription, array $message): PushDelivery;
}
