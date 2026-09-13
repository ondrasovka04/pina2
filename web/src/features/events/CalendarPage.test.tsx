import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { Role, TeamEvent } from '@/lib/types'

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

function pad(value: number): string {
	return String(value).padStart(2, '0')
}

function event(overrides: Partial<TeamEvent> = {}): TeamEvent {
	return {
		id: 1,
		seasonId: 10,
		seriesId: null,
		type: 'training',
		title: 'Trénink',
		startsAt: '2099-09-15 19:00:00',
		endsAt: null,
		meetAt: null,
		location: null,
		opponent: null,
		note: null,
		distanceKm: null,
		travelLinkEvent: null,
		rsvpDeadlineAt: null,
		rsvpDeadlineCustom: null,
		status: 'planned',
		isHome: null,
		overridden: false,
		started: false,
		rosterCount: 1,
		counts: { yes: 0, no: 0, unknown: 1 },
		me: {
			membershipId: 1,
			rsvp: 'unknown',
			rsvpNote: null,
			rsvpAt: null,
			rsvpLate: false,
			nomination: 'none',
			transport: 'none',
			carSeats: null,
			attendance: null,
		},
		...overrides,
	}
}

function localDateTime(date: Date): string {
	return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}:00`
}

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
	beforeEach(() => {
		get.mockReset()
		get.mockResolvedValue({ events: [] })
	})
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

describe('CalendarPage — termín vlastní odpovědi', () => {
	beforeEach(() => {
		get.mockReset()
	})

	it('v řádku ukáže po termínu jen u vlastní chybějící odpovědi', async () => {
		get.mockResolvedValue({
			events: [
				event({ id: 1, title: 'Nejbližší' }),
				event({ id: 2, title: 'Další', rsvpDeadlineAt: '2020-09-15 18:00:00' }),
				event({
					id: 3,
					title: 'Odpovězená',
					rsvpDeadlineAt: '2020-09-15 18:00:00',
					me: { ...event().me!, rsvp: 'yes' },
				}),
			],
		})

		await renderAs('player')

		expect(screen.getAllByText('po termínu')).toHaveLength(1)
	})

	it('v řádku ukáže blížící se termín', async () => {
		const soon = localDateTime(new Date(Date.now() + 60 * 60 * 1000))
		get.mockResolvedValue({
			events: [event({ id: 1, title: 'Nejbližší' }), event({ id: 2, title: 'Další', rsvpDeadlineAt: soon })],
		})

		await renderAs('player')

		expect(screen.getByText('termín brzy')).toBeInTheDocument()
	})
})

describe('CalendarPage — vlastní odpověď v seznamu', () => {
	beforeEach(() => {
		get.mockReset()
	})

	it('u další akce ukáže, jak jsem odpověděl', async () => {
		get.mockResolvedValue({
			events: [
				event({ id: 1, title: 'Nejbližší' }),
				event({ id: 2, title: 'Zápas', me: { ...event().me!, rsvp: 'yes' } }),
				event({ id: 3, title: 'Trénink', me: { ...event().me!, rsvp: 'no' } }),
			],
		})

		await renderAs('player')

		expect(screen.getByText('Přijdu', { selector: 'span' })).toBeInTheDocument()
		expect(screen.getByText('Nepřijdu', { selector: 'span' })).toBeInTheDocument()
	})

	it('neznámou odpověď neduplikuje s odznakem termínu', async () => {
		get.mockResolvedValue({
			events: [
				event({ id: 1, title: 'Nejbližší' }),
				event({ id: 2, title: 'Další', rsvpDeadlineAt: '2020-09-15 18:00:00' }),
			],
		})

		await renderAs('player')

		expect(screen.getByText('po termínu')).toBeInTheDocument()
		expect(screen.queryByText('Nevím')).toBeNull()
	})

	it('u proběhlé a zrušené akce odznak odpovědi nesvítí', async () => {
		get.mockResolvedValue({
			events: [
				event({ id: 1, title: 'Nejbližší' }),
				event({ id: 2, title: 'Proběhlá', started: true, me: { ...event().me!, rsvp: 'yes' } }),
				event({ id: 3, title: 'Zrušená', status: 'cancelled', me: { ...event().me!, rsvp: 'no' } }),
			],
		})

		await renderAs('player')

		expect(screen.queryByText('Přijdu', { selector: 'span' })).toBeNull()
		expect(screen.queryByText('Nepřijdu', { selector: 'span' })).toBeNull()
	})
})
