import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const teamValue = {
	team: { id: 4, name: 'Muži', clubId: 1 },
	can: () => true,
}

vi.mock('@/app/team', () => ({ useTeam: () => teamValue }))

const get = vi.fn()
const put = vi.fn()

vi.mock('@/lib/api', async (importOriginal) => {
	const actual = await importOriginal<typeof import('@/lib/api')>()

	return { ...actual, api: { ...actual.api, get, put } }
})

const { SeasonsPage } = await import('@/features/seasons/SeasonsPage')

const season = {
	id: 10,
	teamId: 4,
	name: '26/27',
	startsOn: '2026-09-01',
	endsOn: '2027-06-30',
	isCurrent: true,
	closedAt: null,
	rosterCount: 1,
}

const members = [
	{
		id: 1,
		userId: 1,
		name: 'Ondra',
		email: 'a@b.cz',
		role: 'player',
		status: 'active',
		jerseyNumber: 7,
		paymentReference: '1',
		joinedAt: '2026-09-01',
		hasPassword: true,
	},
	{
		id: 2,
		userId: 2,
		name: 'Vénis',
		email: 'c@d.cz',
		role: 'player',
		status: 'active',
		jerseyNumber: 9,
		paymentReference: '2',
		joinedAt: '2026-09-01',
		hasPassword: true,
	},
]

/** Na soupisce je na začátku jen Ondra. */
const roster = [
	{
		membershipId: 1,
		userId: 1,
		name: 'Ondra',
		role: 'player',
		status: 'active',
		jerseyNumber: 7,
		paymentReference: '1',
	},
]

function renderPage() {
	const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })

	return render(
		<QueryClientProvider client={client}>
			<MemoryRouter>
				<SeasonsPage />
			</MemoryRouter>
		</QueryClientProvider>,
	)
}

async function openRoster(user: ReturnType<typeof userEvent.setup>) {
	await screen.findByText('26/27')
	await user.click(screen.getByText('Soupiska'))

	return screen.findByRole('checkbox', { name: /Vénis/ })
}

describe('SeasonsPage — soupiska', () => {
	beforeEach(() => {
		get.mockReset()
		put.mockReset()

		get.mockImplementation((path: string) => {
			if (path.includes('/seasons') && path.includes('/teams')) {
				return Promise.resolve({ seasons: [season] })
			}
			if (path.includes('/roster')) {
				return Promise.resolve({ roster })
			}
			if (path.includes('/members')) {
				return Promise.resolve({ members })
			}

			return Promise.resolve({})
		})
		put.mockResolvedValue({ roster })
	})

	it('zaškrtnutí uloží soupisku rovnou, bez tlačítka', async () => {
		const user = userEvent.setup()
		renderPage()

		const checkbox = await openRoster(user)
		expect(screen.queryByRole('button', { name: 'Uložit soupisku' })).toBeNull()

		await user.click(checkbox)

		await waitFor(() => expect(put).toHaveBeenCalledTimes(1))
		expect(put.mock.calls[0]?.[0]).toBe('/seasons/10/roster')
		// Server soupisku nahrazuje celou, takže se posílá i ten, kdo na ní už byl.
		expect(put.mock.calls[0]?.[1]).toEqual({ membershipIds: [1, 2] })
	})

	it('odškrtnutí pošle seznam bez daného člena', async () => {
		const user = userEvent.setup()
		renderPage()

		await openRoster(user)
		await user.click(screen.getByRole('checkbox', { name: /Ondra/ }))

		await waitFor(() => expect(put).toHaveBeenCalledTimes(1))
		expect(put.mock.calls[0]?.[1]).toEqual({ membershipIds: [] })
	})

	it('když uložení selže, výběr se vrátí zpátky', async () => {
		const user = userEvent.setup()
		put.mockRejectedValue(new Error('bez signálu'))
		renderPage()

		const checkbox = await openRoster(user)
		await user.click(checkbox)

		await screen.findByText(/uložení selhalo/)
		// Obrazovka nesmí ukazovat soupisku, která na serveru není.
		expect(checkbox).not.toBeChecked()
	})
})
