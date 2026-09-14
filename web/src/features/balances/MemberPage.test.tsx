import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router'

import { atLeast } from '@/lib/types'
import type { BalanceList, MemberBalance, Role } from '@/lib/types'

const state = vi.hoisted(() => ({ role: 'player' as Role, closed: false }))
vi.mock('@/app/team', () => ({
	useTeam: () => ({
		team: { id: 4, membershipId: 1 },
		seasonId: 10,
		can: (required: Role) => atLeast(state.role, required),
		isSeasonClosed: state.closed,
	}),
}))

const get = vi.fn()
vi.mock('@/lib/api', async (importOriginal) => {
	const actual = await importOriginal<typeof import('@/lib/api')>()
	return { ...actual, api: { ...actual.api, get } }
})

const { MemberPage } = await import('@/features/balances/MemberPage')

function member(membershipId: number): MemberBalance {
	return {
		membershipId,
		userId: membershipId,
		name: membershipId === 1 ? 'Ondra' : 'Karel',
		avatarUrl: '/avatar.png',
		jerseyNumber: 7,
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
}

const balances: BalanceList = {
	seasonId: 10,
	visibility: 'team',
	halfYearOn: null,
	periods: [],
	totals: member(1),
	halves: null,
	totalCzk: 200,
	offencesCzk: 200,
	bonusesCzk: 0,
	paidCzk: 0,
	travelCzk: 0,
	members: [member(1), member(2)],
}

function renderPage(membershipId = 2) {
	const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
	return render(
		<QueryClientProvider client={client}>
			<MemoryRouter initialEntries={[`/hraci/${membershipId}`]}>
				<Routes>
					<Route path="/hraci/:membershipId" element={<MemberPage />} />
				</Routes>
			</MemoryRouter>
		</QueryClientProvider>,
	)
}

beforeEach(() => {
	state.role = 'player'
	state.closed = false
	get.mockReset()
	get.mockImplementation(async (path: string) => {
		if (path.endsWith('/balances')) return balances
		if (path === '/teams/4') return { settings: { travelEnabled: false } }
		if (path.includes('/payment-qr'))
			return {
				amountCzk: 100,
				spayd: null,
				bankAccount: null,
				period: { name: 'Celá sezóna' },
			}
		return { items: [] }
	})
})

describe('MemberPage', () => {
	it('hráči nezobrazí cizí QR ani chybu a vůbec o něj nežádá API', async () => {
		renderPage()
		await screen.findByText('Karel')
		expect(screen.queryByText(/QR|Zkusit znovu/)).toBeNull()
		expect(get.mock.calls.some(([path]) => String(path).includes('/payment-qr'))).toBe(false)
	})

	it.each<Role>(['treasurer', 'admin'])('roli %s zachová možnost připravit QR spoluhráče', async (role) => {
		state.role = role
		renderPage()
		expect(await screen.findByRole('heading', { name: 'QR platba pro Karel' })).toBeInTheDocument()
		expect(get).toHaveBeenCalledWith('/memberships/2/payment-qr?seasonId=10', expect.any(AbortSignal))
	})

	it('vlastní QR nezdvojuje z přehledu dluhů', async () => {
		renderPage(1)
		await screen.findByText('Ondra')
		expect(get.mock.calls.some(([path]) => String(path).includes('/payment-qr'))).toBe(false)
	})

	it('pínaři zachová QR i v uzavřené sezóně bez možnosti zapisovat platby', async () => {
		state.role = 'treasurer'
		state.closed = true
		renderPage()
		await screen.findByRole('heading', { name: 'QR platba pro Karel' })
		expect(screen.queryByRole('button', { name: 'Zapsat přijatou platbu' })).toBeNull()
	})

	it('zvětší profilovku z detailu dluhů', async () => {
		const user = userEvent.setup()
		renderPage()
		await user.click(await screen.findByRole('button', { name: 'Zvětšit profilovou fotku: Karel' }))
		expect(screen.getByRole('dialog', { name: 'Karel' })).toBeInTheDocument()
	})
})
