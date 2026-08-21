<?php

declare(strict_types=1);

namespace Pina\Controller;

use Pina\Http\ApiException;
use Pina\Http\Request;
use Pina\Http\Response;
use Pina\Service\FinanceService;

final class FinanceController
{
    public function __construct(private readonly FinanceService $finance)
    {
    }

    public function payments(Request $request): Response
    {
        return Response::ok($this->finance->payments(
            $request->identity(),
            $request->routeId('season'),
            $request->queryInt('membershipId'),
            $request->queryString('includeVoided') === '1',
        ));
    }

    public function createPayment(Request $request): Response
    {
        return Response::created($this->finance->createPayment($request->identity(), $request->routeId('season'), [
            'membershipId' => $request->int('membershipId'),
            'amountCzk'    => $request->int('amountCzk'),
            'paidOn'       => $request->string('paidOn'),
            'method'       => $request->string('method', 'cash'),
            'note'         => $request->optionalString('note'),
        ]));
    }

    public function voidPayment(Request $request): Response
    {
        return Response::ok($this->finance->voidPayment(
            $request->identity(),
            $request->routeId('id'),
            $request->string('reason'),
        ));
    }

    public function travelClaims(Request $request): Response
    {
        return Response::ok($this->finance->travelClaims(
            $request->identity(),
            $request->routeId('season'),
            $request->queryInt('membershipId'),
            $request->queryString('includeVoided') === '1',
        ));
    }

    public function syncTravelClaims(Request $request): Response
    {
        return Response::ok($this->finance->syncTravelClaims($request->identity(), $request->routeId('season')));
    }

    public function createTravelClaim(Request $request): Response
    {
        return Response::created($this->finance->createTravelClaim($request->identity(), $request->routeId('season'), [
            'membershipId' => $request->int('membershipId'),
            'occurredOn'   => $request->string('occurredOn'),
            'distanceKm'   => $request->int('distanceKm'),
            'note'         => $request->optionalString('note'),
        ]));
    }

    public function voidTravelClaim(Request $request): Response
    {
        return Response::ok($this->finance->voidTravelClaim($request->identity(), $request->routeId('id')));
    }

    public function paymentQr(Request $request): Response
    {
        $seasonId = $request->queryInt('seasonId');
        if ($seasonId === null || $seasonId <= 0) {
            throw ApiException::validation('Chybí sezóna pro výpočet platby.', ['field' => 'seasonId']);
        }

        return Response::ok($this->finance->paymentQr(
            $request->identity(),
            $seasonId,
            $request->routeId('id'),
        ));
    }
}
