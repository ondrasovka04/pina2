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
	rsvpDeadlineTrainingHours: 24,
	rsvpDeadlineMatchHours: 48,
	bankAccount: '19-2000145399/0800',
}

const team = {
	id: 4,
	name: 'Muži',
	color: null,
	archivedAt: null,
	clubId: 1,
	clubName: 'SK Prosek',
	logoUrl: null,
	memberCount: 18,
	settings,
}

function renderSection(shown = team) {
	const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })

	const result = render(
		<QueryClientProvider client={client}>
			<MemoryRouter>
				<TeamSettingsSection team={shown} />
			</MemoryRouter>
		</QueryClientProvider>,
	)

	/** Přepnutí družstva bez odmontování — detail druhého družstva bývá v cache. */
	function switchTo(other: typeof team) {
		result.rerender(
			<QueryClientProvider client={client}>
				<MemoryRouter>
					<TeamSettingsSection team={other} />
				</MemoryRouter>
			</QueryClientProvider>,
		)
	}

	return { ...result, switchTo }
}

/** Uložení, které visí, dokud ho test nepustí dál. */
function deferred() {
	let settle: (() => void) | undefined
	const promise = new Promise<void>((resolve) => {
		settle = resolve
	})

	return { promise, settle: () => settle?.() }
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

	it('změnu termínu odešle jako součást celého nastavení a prázdné pole ho vypne', async () => {
		const user = userEvent.setup()
		renderSection()

		const training = screen.getByLabelText('Zápis na trénink (h)')
		await user.clear(training)

		await waitFor(() => expect(put).toHaveBeenCalledTimes(1), { timeout: 3000 })
		expect(put.mock.calls[0]?.[1]).toEqual({ ...settings, rsvpDeadlineTrainingHours: null })
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

	it('rozepsané číslo účtu se neposílá, dokud nemá tvar účtu', async () => {
		const user = userEvent.setup()
		renderSection()

		const account = screen.getByLabelText('Účet pro QR platby')
		await user.clear(account)
		await user.type(account, '123456789')

		// Ani po prodlevě — chybí kód banky, server by hlásil chybu nad půlkou účtu.
		await new Promise((resolve) => setTimeout(resolve, 900))
		expect(put).not.toHaveBeenCalled()

		await user.type(account, '/0800')
		await waitFor(() => expect(put).toHaveBeenCalledTimes(1), { timeout: 3000 })
		expect(put.mock.calls[0]?.[1]).toEqual({ ...settings, bankAccount: '123456789/0800' })
	})

	it('cvaknutí přepínače neuspěchá odeslání rozepsaného účtu', async () => {
		const user = userEvent.setup()
		renderSection()

		const account = screen.getByLabelText('Účet pro QR platby')
		await user.clear(account)
		await user.type(account, '123456789')
		// Přepínač ukládá hned; nesmí s sebou vzít účet, na který pak míří QR platba.
		await user.click(screen.getByRole('checkbox', { name: /Cesťáky/ }))

		await waitFor(() => expect(put).toHaveBeenCalledTimes(1))
		expect(put.mock.calls[0]?.[1]).toEqual({ ...settings, travelEnabled: false })
	})

	it('selhání staršího uložení nezahodí novější změnu', async () => {
		const user = userEvent.setup()
		const first = deferred()

		put.mockImplementationOnce(async () => {
			await first.promise
			throw new Error('bez signálu')
		})
		put.mockResolvedValue(settings)
		renderSection()

		const attendance = screen.getByRole('checkbox', { name: /Docházka ostatních/ })
		const balances = screen.getByRole('checkbox', { name: /Dluhy ostatních/ })

		await user.click(attendance)
		await user.click(balances)
		// Teprve teď selže první požadavek — druhý už je naplánovaný za ním.
		first.settle()

		await waitFor(() => expect(put).toHaveBeenCalledTimes(2))
		// Druhá změna je na serveru, takže ji obrazovka nesmí vizuálně vrátit.
		expect(balances).not.toBeChecked()
	})

	it('odpověď pro předchozí družstvo nepřepíše zobrazené nastavení', async () => {
		const user = userEvent.setup()
		const first = deferred()

		put.mockImplementationOnce(async () => {
			await first.promise

			return settings
		})
		const other = { ...team, id: 9, name: 'Junioři', settings: { ...settings, travelRateCzkKm: 12 } }
		const { switchTo } = renderSection()

		await user.click(screen.getByRole('checkbox', { name: /Docházka ostatních/ }))
		switchTo(other)

		await screen.findByDisplayValue('12')
		first.settle()

		// Uložení patřilo mužům; juniorům nesmí přepsat sazbu ani vypsat „uloženo".
		await waitFor(() => expect(screen.getByDisplayValue('12')).toBeInTheDocument())
		expect(screen.queryByText('uloženo')).toBeNull()
	})
})
