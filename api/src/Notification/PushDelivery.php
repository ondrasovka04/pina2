<?php

declare(strict_types=1);

namespace Pina\Notification;

final readonly class PushDelivery
{
    private function __construct(
        public bool $success,
        public bool $expired,
        public string $reason,
    ) {
    }

    public static function delivered(): self
    {
        return new self(true, false, 'OK');
    }

    public static function expired(string $reason): self
    {
        return new self(false, true, $reason);
    }

    public static function failed(string $reason): self
    {
        return new self(false, false, $reason);
    }
}
