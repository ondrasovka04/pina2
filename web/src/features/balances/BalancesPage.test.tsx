import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { BalanceList, MemberBalance } from '@/lib/types'

const state = vi.hoisted(() => ({ membershipId: null as number | null }))
vi.mock('@/app/team', () => ({
	useTeam: () => ({ team: { id: 4, membershipId: state.membershipId, travelEnabled: false }, seasonId: 10 }),
}))
const get = vi.fn()
vi.mock('@/lib/api', async (importOriginal) => {
	const actual = await importOriginal<typeof import('@/lib/api')>()
	return { ...actual, api: { ...actual.api, get } }
})
const { BalancesPage } = await import('@/features/balances/BalancesPage')

const member: MemberBalance = {
	membershipId: 2,
	userId: 2,
	name: 'Karel',
	avatarUrl: null,
	jerseyNumber: null,
	status: 'active',
	onRoster: true,
	recordCount: 1,
	offencesCzk: 100,
	bonusesCzk: 0,
	paidCzk: 0,
	travelCzk: 0,
	balanceCzk: 100,
	halves: null,
}
const balances: BalanceList = {
	seasonId: 10,
	visibility: 'team',
	halfYearOn: null,
	periods: [],
	totals: member,
	halves: null,
	totalCzk: 100,
	offencesCzk: 100,
	bonusesCzk: 0,
	paidCzk: 0,
	travelCzk: 0,
	members: [member],
}

function renderPage() {
	const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
	return render(
		<QueryClientProvider client={client}>
			<MemoryRouter>
				<BalancesPage />
			</MemoryRouter>
		</QueryClientProvider>,
	)
}

describe('dluhy v podpoře', () => {
	beforeEach(() => {
		state.membershipId = null
		get.mockReset()
		get.mockImplementation((path: string) =>
			Promise.resolve(
				path.endsWith('/balances')
					? balances
					: {
							amountCzk: 0,
							spayd: null,
							bankAccount: null,
							period: { name: 'Celá sezóna' },
						},
			),
		)
	})

	it('nečlenovi ukáže týmové dluhy bez vlastního konta a bez požadavku na vlastní QR', async () => {
		renderPage()
		await screen.findByText('Karel')
		expect(screen.getByText('Zbývá vyrovnat')).toBeInTheDocument()
		expect(screen.queryByText('Můj dluh')).toBeNull()
		expect(get.mock.calls.some(([path]) => String(path).includes('/payment-qr'))).toBe(false)
	})

	it('skutečnému členovi zachová vlastní konto i během podpory', async () => {
		state.membershipId = 2
		renderPage()
		await screen.findByText('Můj dluh')
		expect(get).toHaveBeenCalledWith('/memberships/2/payment-qr?seasonId=10', expect.any(AbortSignal))
	})
})
