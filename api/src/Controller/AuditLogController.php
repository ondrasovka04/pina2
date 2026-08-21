<?php

declare(strict_types=1);

namespace Pina\Controller;

use Pina\Http\ApiException;
use Pina\Http\Request;
use Pina\Http\Response;
use Pina\Service\AuditLog;

final class AuditLogController
{
    public function __construct(private readonly AuditLog $audit)
    {
    }

    public function index(Request $request): Response
    {
        $limit  = $request->queryInt('limit', 25) ?? 25;
        $offset = $request->queryInt('offset', 0) ?? 0;

        if ($limit < 1 || $limit > 100) {
            throw ApiException::validation('Limit musí být mezi 1 a 100.', ['field' => 'limit']);
        }

        return Response::ok($this->audit->forTeam(
            $request->identity(),
            $request->routeId('team'),
            $limit,
            $offset,
        ));
    }
}
