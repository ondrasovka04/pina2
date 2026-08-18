<?php

declare(strict_types=1);

namespace Pina\Controller;

use Pina\Http\ApiException;
use Pina\Http\Request;
use Pina\Http\Response;
use Pina\Service\CalendarFeedService;

/** Odběr kalendáře pro telefon a jeho správa v profilu. */
final class CalendarFeedController
{
    public function __construct(private readonly CalendarFeedService $feeds)
    {
    }

    public function index(Request $request): Response
    {
        return Response::ok(['feeds' => $this->feeds->list($request->identity())]);
    }

    public function issue(Request $request): Response
    {
        return Response::created($this->feeds->issue($request->identity(), $request->routeId('season')));
    }

    public function revoke(Request $request): Response
    {
        $this->feeds->revoke($request->identity(), $request->routeId('id'));

        return Response::noContent();
    }

    public function show(Request $request): Response
    {
        $token = $request->routeString('token');
        if (preg_match('/^[a-f0-9]{64}$/', $token) !== 1) {
            throw ApiException::notFound();
        }

        $document = $this->feeds->document($token, $request->header('if-none-match'));
        $headers  = [
            'Cache-Control' => 'private, max-age=0, must-revalidate',
            'ETag'          => $document['etag'],
        ];

        if ($document['notModified']) {
            return Response::notModified($headers, 'text/calendar; charset=utf-8');
        }

        return Response::raw($document['body'], 'text/calendar; charset=utf-8', headers: $headers);
    }
}
