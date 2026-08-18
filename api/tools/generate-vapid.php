<?php

declare(strict_types=1);

use Minishlink\WebPush\VAPID;

require dirname(__DIR__) . '/vendor/autoload.php';

$keys = VAPID::createVapidKeys();

echo "VAPID_PUBLIC_KEY={$keys['publicKey']}\n";
echo "VAPID_PRIVATE_KEY={$keys['privateKey']}\n";
