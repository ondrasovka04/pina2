import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const team = vi.hoisted(() => ({ usesAttendance: true }))

vi.mock('@/app/team', () => ({
	useTeam: () => ({ seasonId: 10, can: () => true, usesAttendance: team.usesAttendance }),
}))

const get = vi.fn()
const post = vi.fn()

vi.mock('@/lib/api', async (importOriginal) => {
	const actual = await importOriginal<typeof import('@/lib/api')>()

	return { ...actual, api: { ...actual.api, get, post } }
})

const { OffenceTypesPage } = await import('@/features/offences/OffenceTypesPage')

async function renderPage() {
	const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })

	render(
		<QueryClientProvider client={client}>
			<MemoryRouter>
				<OffenceTypesPage />
			</MemoryRouter>
		</QueryClientProvider>,
	)

	await screen.findByText('Sazebník')
}

beforeEach(() => {
	team.usesAttendance = true
	get.mockReset()
	post.mockReset()
	get.mockResolvedValue({ items: [] })
	post.mockResolvedValue({})
})

describe('zakládání položky sazebníku', () => {
	it('nabídne pravidlo a druh akce odhalí až po jeho zvolení', async () => {
		const user = userEvent.setup()
		await renderPage()

		await user.click(screen.getByRole('button', { name: /Přidat položku/ }))

		const rule = screen.getByLabelText('Navrhovat z docházky')
		expect(rule).toBeInTheDocument()
		expect(screen.queryByLabelText('U kterých akcí')).not.toBeInTheDocument()

		await user.selectOptions(rule, 'late_rsvp')

		expect(screen.getByLabelText('U kterých akcí')).toBeInTheDocument()
	})

	it('pošle pravidlo i druh akce na server', async () => {
		const user = userEvent.setup()
		await renderPage()

		await user.click(screen.getByRole('button', { name: /Přidat položku/ }))
		await user.type(screen.getByLabelText('Název'), 'Pozdní zápis')
		await user.type(screen.getByLabelText('Částka v Kč'), '20')
		await user.selectOptions(screen.getByLabelText('Navrhovat z docházky'), 'late_rsvp')
		await user.selectOptions(screen.getByLabelText('U kterých akcí'), 'training')
		await user.click(screen.getByRole('button', { name: 'Uložit' }))

		expect(post).toHaveBeenCalledWith('/seasons/10/offence-types', {
			name: 'Pozdní zápis',
			amountCzk: 20,
			category: null,
			autoRule: 'late_rsvp',
			autoEventType: 'training',
		})
	})

	it('bez docházky blok návrhů nenabízí', async () => {
		team.usesAttendance = false
		const user = userEvent.setup()
		await renderPage()

		await user.click(screen.getByRole('button', { name: /Přidat položku/ }))

		expect(screen.queryByLabelText('Navrhovat z docházky')).toBeNull()
	})
})
