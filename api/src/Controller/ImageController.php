<?php

declare(strict_types=1);

namespace Pina\Controller;

use Pina\Http\Request;
use Pina\Http\Response;
use Pina\Service\ImageService;

final class ImageController
{
    public function __construct(private readonly ImageService $images)
    {
    }

    public function show(Request $request): Response
    {
        return Response::image($this->images->contents(
            $request->routeString('kind'),
            $request->routeString('file'),
        ));
    }

    public function saveUser(Request $request): Response
    {
        return Response::ok([
            'avatarUrl' => $this->images->saveUser($request->identity(), $request->string('image')),
        ]);
    }

    public function removeUser(Request $request): Response
    {
        $this->images->removeUser($request->identity());

        return Response::ok(['avatarUrl' => null]);
    }

    public function saveTeam(Request $request): Response
    {
        return Response::ok([
            'logoUrl' => $this->images->saveTeam(
                $request->identity(),
                $request->routeId('team'),
                $request->string('image'),
            ),
        ]);
    }

    public function removeTeam(Request $request): Response
    {
        $this->images->removeTeam($request->identity(), $request->routeId('team'));

        return Response::ok(['logoUrl' => null]);
    }
}
