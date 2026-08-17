import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/app/team', () => ({ useTeam: () => ({ can: () => true }) }))

const get = vi.fn()
const put = vi.fn()

vi.mock('@/lib/api', async (importOriginal) => {
	const actual = await importOriginal<typeof import('@/lib/api')>()

	return { ...actual, api: { ...actual.api, get, put } }
})

const { TeamSettingsSection } = await import('@/features/team/TeamSettingsSection')

const settings = {
	travelEnabled: true,
	travelRateCzkKm: 5,
	travelRoundTrip: true,
	homeLocationId: 3,
	attendanceVisibleToPlayers: true,
	balancesVisibleToPlayers: true,
	bankAccount: '19-2000145399/0800',
}

const team = {
	id: 4,
	name: 'Muži',
	color: null,
	archivedAt: null,
	clubId: 1,
	clubName: 'SK Prosek',
	memberCount: 18,
	settings,
}

function renderSection() {
	const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })

	return render(
		<QueryClientProvider client={client}>
			<MemoryRouter>
				<TeamSettingsSection team={team} />
			</MemoryRouter>
		</QueryClientProvider>,
	)
}

describe('TeamSettingsSection — ukládání bez tlačítka', () => {
	beforeEach(() => {
		get.mockReset()
		put.mockReset()

		get.mockResolvedValue({ locations: [{ id: 3, clubId: 1, name: 'Prosek', address: null, archivedAt: null }] })
		put.mockResolvedValue(settings)
	})

	it('přepínač uloží rovnou a tlačítko Uložit nikde není', async () => {
		const user = userEvent.setup()
		renderSection()

		expect(screen.queryByRole('button', { name: 'Uložit' })).toBeNull()

		await user.click(screen.getByRole('checkbox', { name: /Dluhy ostatních/ }))

		await waitFor(() => expect(put).toHaveBeenCalledTimes(1))
		expect(put.mock.calls[0]?.[0]).toBe('/teams/4/settings')
		// Server přijímá celé nastavení, takže se posílá i to, co se nezměnilo.
		expect(put.mock.calls[0]?.[1]).toEqual({ ...settings, balancesVisibleToPlayers: false })
		await screen.findByText('uloženo')
	})

	it('psaní do čísla účtu pošle jeden požadavek s dopsanou hodnotou', async () => {
		const user = userEvent.setup()
		renderSection()

		const account = screen.getByLabelText('Účet pro QR platby')
		await user.clear(account)
		await user.type(account, '123/0300')

		// Osm stisků klávesy, ale jedno uložení — jinak by server dostal i nesmysly cestou.
		await waitFor(() => expect(put).toHaveBeenCalledTimes(1), { timeout: 3000 })
		expect(put.mock.calls[0]?.[1]).toEqual({ ...settings, bankAccount: '123/0300' })
	})

	it('když uložení selže, hodnota se vrátí na potvrzenou', async () => {
		const user = userEvent.setup()
		put.mockRejectedValue(new Error('bez signálu'))
		renderSection()

		const checkbox = screen.getByRole('checkbox', { name: /Docházka ostatních/ })
		await user.click(checkbox)

		await screen.findByText(/uložení selhalo/)
		// Obrazovka nesmí ukazovat nastavení, které na serveru neplatí.
		expect(checkbox).toBeChecked()
	})
})
