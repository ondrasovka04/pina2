import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { describe, expect, it, vi } from 'vitest'

import type { Role } from '@/lib/types'

const roles: Role[] = ['player', 'treasurer', 'admin']

let role: Role = 'player'

vi.mock('@/app/team', () => ({
	useTeam: () => ({
		team: { id: 4, name: 'Muži', clubId: 1, clubName: 'SK Prosek' },
		season: { id: 10, name: '26/27' },
		seasonId: 10,
		isSeasonClosed: false,
		can: (needed: Role) => roles.indexOf(role) >= roles.indexOf(needed),
	}),
}))

const get = vi.fn().mockResolvedValue({ events: [] })

vi.mock('@/lib/api', async (importOriginal) => {
	const actual = await importOriginal<typeof import('@/lib/api')>()

	return { ...actual, api: { ...actual.api, get } }
})

const { CalendarPage } = await import('@/features/events/CalendarPage')

async function renderAs(as: Role) {
	role = as

	const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
	render(
		<QueryClientProvider client={client}>
			<MemoryRouter>
				<CalendarPage />
			</MemoryRouter>
		</QueryClientProvider>,
	)

	await screen.findByText('Kalendář')
}

describe('CalendarPage — kdo smí zakládat akce', () => {
	it('pínař vidí tlačítko Nová akce', async () => {
		await renderAs('treasurer')

		expect(screen.getByRole('button', { name: /Nová akce/ })).toBeInTheDocument()
	})

	it('hráč tlačítko nevidí a prázdný kalendář mu to řekne jinak', async () => {
		await renderAs('player')

		expect(screen.queryByRole('button', { name: /Nová akce/ })).toBeNull()
		expect(await screen.findByText('Zatím nic naplánované')).toBeInTheDocument()
	})
})
