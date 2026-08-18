<?php

declare(strict_types=1);

namespace Pina\Http;

/** HTTP odpověď. Běžné API je JSON, veřejný kalendář používá surové tělo. */
final class Response
{
    /**
     * @param array<string,mixed>|list<mixed>|null $data
     * @param array<string,string>                 $headers
     */
    public function __construct(
        public readonly int $status = 200,
        public readonly array|null $data = null,
        public readonly array $headers = [],
        public readonly ?string $cookie = null,
        public readonly ?string $rawBody = null,
        public readonly string $contentType = 'application/json; charset=utf-8',
    ) {
    }

    /** @param array<string,mixed>|list<mixed> $data */
    public static function ok(array $data): self
    {
        return new self(200, $data);
    }

    /** @param array<string,mixed> $data */
    public static function created(array $data): self
    {
        return new self(201, $data);
    }

    public static function noContent(): self
    {
        return new self(204);
    }

    /** @param array<string,string> $headers */
    public static function raw(
        string $body,
        string $contentType,
        int $status = 200,
        array $headers = [],
    ): self {
        return new self($status, headers: $headers, rawBody: $body, contentType: $contentType);
    }

    /** @param array<string,string> $headers */
    public static function notModified(
        array $headers = [],
        string $contentType = 'application/json; charset=utf-8',
    ): self {
        return new self(304, headers: $headers, contentType: $contentType);
    }

    public static function error(ApiException $e): self
    {
        return new self($e->status, [
            'error' => array_filter([
                'code'    => $e->errorCode,
                'message' => $e->getMessage(),
                'details' => $e->details === [] ? null : $e->details,
            ], static fn (mixed $v): bool => $v !== null),
        ]);
    }

    public function withCookie(string $cookie): self
    {
        return new self(
            $this->status,
            $this->data,
            $this->headers,
            $cookie,
            $this->rawBody,
            $this->contentType,
        );
    }

    public function send(): void
    {
        http_response_code($this->status);
        header('Content-Type: ' . $this->contentType);

        foreach ($this->headers as $name => $value) {
            header("$name: $value");
        }

        if ($this->cookie !== null) {
            header('Set-Cookie: ' . $this->cookie, false);
        }

        if ($this->rawBody !== null) {
            echo $this->rawBody;
        } elseif ($this->data !== null) {
            echo json_encode($this->data, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
        }
    }
}
