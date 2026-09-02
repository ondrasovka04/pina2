import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { BalanceList, TravelClaim } from '@/lib/types'

const state = vi.hoisted(() => ({ travelEnabled: false, claims: [] as TravelClaim[] }))

vi.mock('@/app/team', () => ({
	useTeam: () => ({
		team: { id: 4, membershipId: 1, travelEnabled: state.travelEnabled },
		seasonId: 10,
		can: () => true,
		isSeasonClosed: false,
		usesAttendance: true,
	}),
}))

const sums = { offencesCzk: 0, bonusesCzk: 0, paidCzk: 500, travelCzk: 0, balanceCzk: -500, recordCount: 0 }

const balances: BalanceList = {
	seasonId: 10,
	visibility: 'team',
	halfYearOn: null,
	periods: [{ key: 'all', from: '2026-09-01', to: '2027-06-30', label: 'Celá sezóna' }],
	totals: sums,
	halves: null,
	totalCzk: -500,
	offencesCzk: 0,
	bonusesCzk: 0,
	paidCzk: 500,
	travelCzk: 0,
	members: [],
}

vi.mock('@/lib/queries', () => ({
	useBalances: () => ({ data: balances, isPending: false, error: null }),
	usePayments: () => ({ data: [], isPending: false, error: null }),
	useTravelClaims: () => ({ data: state.claims, isPending: false, error: null }),
	useSyncTravelClaims: () => ({ mutate: vi.fn(), isPending: false }),
	useVoidPayment: () => ({ mutate: vi.fn(), isPending: false }),
	useVoidTravelClaim: () => ({ mutate: vi.fn(), isPending: false }),
}))

const { PaymentsPage } = await import('@/features/balances/PaymentsPage')

function claim(): TravelClaim {
	return {
		id: 1,
		seasonId: 10,
		membershipId: 2,
		memberName: 'Karel Novák',
		memberAvatarUrl: null,
		eventId: null,
		eventTitle: null,
		occurredOn: '2026-10-05',
		distanceKm: 40,
		rateCzkKm: 5,
		amountCzk: 200,
		note: 'Turnaj',
		createdAt: '2026-10-06 10:00:00',
		voidedAt: null,
	}
}

function renderPage() {
	render(
		<MemoryRouter>
			<PaymentsPage />
		</MemoryRouter>,
	)
}

beforeEach(() => {
	state.travelEnabled = false
	state.claims = []
})

describe('PaymentsPage — záložka cesťáků', () => {
	it('vypnuté cesťáky bez historie se nenabízejí vůbec', () => {
		renderPage()

		expect(screen.queryByRole('button', { name: /Cesťáky/ })).toBeNull()
		expect(screen.getByRole('heading', { name: 'Platby' })).toBeInTheDocument()
	})

	// Vzniklé náhrady pořád snižují dluh, takže je vypnutí v nastavení nesmí schovat.
	it('vypnuté cesťáky s historií zůstávají dostupné a řeknou proč', () => {
		state.claims = [claim()]
		renderPage()

		expect(screen.getByRole('button', { name: /Cesťáky/ })).toBeInTheDocument()
		expect(screen.getByRole('heading', { name: 'Platby a cesťáky' })).toBeInTheDocument()
	})

	it('zapnuté cesťáky mají záložku i bez jediného záznamu', () => {
		state.travelEnabled = true
		renderPage()

		expect(screen.getByRole('button', { name: /Cesťáky/ })).toBeInTheDocument()
	})
})
