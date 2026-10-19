import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { ApiError } from '@/lib/api'
import type { EventDetail, Role, TeamEvent } from '@/lib/types'

vi.mock('@/app/session', () => ({ useCurrentUser: () => ({ id: 1 }) }))

beforeEach(() => {
	sessionStorage.clear()
	vi.stubGlobal('scrollTo', vi.fn())
})

const roles: Role[] = ['player', 'treasurer', 'admin']

let role: Role = 'player'
let seasonClosed = false

vi.mock('@/app/team', () => ({
	useTeam: () => ({
		team: { id: 4, name: 'Muži', clubId: 1, clubName: 'SK Prosek' },
		season: { id: 10, name: '26/27' },
		seasonId: 10,
		isSeasonClosed: seasonClosed,
		can: (needed: Role) => roles.indexOf(role) >= roles.indexOf(needed),
	}),
}))

const { get, put } = vi.hoisted(() => ({ get: vi.fn().mockResolvedValue({ events: [] }), put: vi.fn() }))

vi.mock('@/lib/api', async (importOriginal) => {
	const actual = await importOriginal<typeof import('@/lib/api')>()

	return { ...actual, api: { ...actual.api, get, put } }
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
		nominationPublished: false,
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
			nominationPosition: null,
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

function scrollingRow(title = 'Další') {
	const button = screen.getByRole('button', { name: `Účast na akci: ${title}` })
	const row = button.parentElement?.parentElement
	if (row === null || row === undefined) {
		throw new Error('Chybí posuvný řádek')
	}
	const scrollTo = vi.fn(({ left }: ScrollToOptions) => {
		row.scrollLeft = left ?? 0
		fireEvent.scroll(row)
	})
	Object.defineProperties(row, {
		clientWidth: { value: 320 },
		scrollWidth: { value: 480 },
		scrollTo: {
			value: scrollTo,
		},
	})
	return { row, button, scrollTo }
}

describe('CalendarPage — rychlá odpověď v seznamu', () => {
	beforeEach(() => {
		seasonClosed = false
		put.mockReset()
		get.mockReset()
		get.mockResolvedValue({ events: [event(), event({ id: 2, title: 'Další' })] })
		vi.stubGlobal(
			'matchMedia',
			vi.fn(() => ({ matches: true })),
		)
	})

	it.each([true, false])('po termínu vyžádá potvrzení před odesláním (nejbližší: %s)', async (nearest) => {
		const user = userEvent.setup()
		const late = event({
			id: nearest ? 1 : 2,
			title: nearest ? 'Nejbližší' : 'Další',
			rsvpDeadlineAt: '2020-01-01 00:00:00',
			me: { ...event().me!, rsvp: 'yes' },
		})
		get.mockResolvedValue({ events: nearest ? [late] : [event(), late] })
		put.mockResolvedValue({
			event: { ...late, me: { ...late.me!, rsvp: 'no' } },
			participants: [],
			canSeeAttendance: false,
			travelFollowerEvents: [],
		})
		await renderAs('player')
		if (!nearest) {
			await user.click(scrollingRow().button)
		}
		const choice = screen.getByRole('button', { name: nearest ? 'Nepřijdu' : 'Nejdu' })
		await user.click(choice)
		const modal = screen.getByRole('dialog', { name: 'Proč nepřijdeš?' })
		expect(within(modal).getByText(/příplatek/)).toBeInTheDocument()
		expect(put).not.toHaveBeenCalled()
		await user.click(within(modal).getByRole('button', { name: 'Zrušit' }))
		expect(put).not.toHaveBeenCalled()
		await user.click(choice)
		const reopened = screen.getByRole('dialog', { name: 'Proč nepřijdeš?' })
		expect(within(reopened).getByRole('button', { name: 'Uložit: nepřijdu' })).toBeDisabled()
		await user.type(within(reopened).getByRole('textbox', { name: 'Důvod omluvy' }), 'Škola')
		await user.click(within(reopened).getByRole('button', { name: 'Uložit: nepřijdu' }))
		await waitFor(() => expect(put).toHaveBeenCalledTimes(1))
		expect(put).toHaveBeenCalledWith(`/events/${late.id}/rsvp`, expect.objectContaining({ rsvp: 'no', note: 'Škola' }))
	})

	it('opakované klepnutí na stejnou účast po termínu nic neodesílá', async () => {
		const user = userEvent.setup()
		get.mockResolvedValue({
			events: [event({ rsvpDeadlineAt: '2020-01-01 00:00:00', me: { ...event().me!, rsvp: 'yes' } })],
		})
		await renderAs('player')
		await user.click(screen.getByRole('button', { name: 'Přijdu' }))
		expect(put).not.toHaveBeenCalled()
		expect(screen.queryByRole('dialog')).toBeNull()
	})

	it('nejbližší akce nabízí mapu podle adresy a zachová odkaz na detail', async () => {
		get.mockResolvedValue({
			events: [
				event({ location: { id: 1, name: 'Hala', address: 'Lovosická 559, Praha', lat: null, lng: null, note: null } }),
			],
		})
		await renderAs('player')
		expect(screen.getByRole('link', { name: 'Hala' })).toHaveAttribute(
			'href',
			'https://www.google.com/maps/dir/?api=1&destination=Lovosick%C3%A1%20559%2C%20Praha',
		)
		expect(screen.getByRole('link', { name: 'Trénink' })).toHaveAttribute('href', '/akce/1')
	})

	it('odtažení jen odkryje nabídku a nic neodešle; návrat ji schová', async () => {
		await renderAs('player')
		const { row, button } = scrollingRow()
		expect(screen.queryByRole('button', { name: 'Jdu' })).toBeNull()
		fireEvent.scroll(row, { target: { scrollLeft: 160 } })
		expect(button).toHaveAttribute('aria-expanded', 'true')
		expect(screen.getByRole('button', { name: 'Jdu' })).toBeInTheDocument()
		expect(put).not.toHaveBeenCalled()
		fireEvent.scroll(row, { target: { scrollLeft: 0 } })
		expect(screen.queryByRole('button', { name: 'Jdu' })).toBeNull()
	})

	it.each(['gesto', 'šipka'])('otevření přes %s zavře předchozí řádek i v jiném měsíci', async (method) => {
		const user = userEvent.setup()
		get.mockResolvedValue({
			events: [
				event(),
				event({ id: 2, title: 'Další' }),
				event({ id: 3, title: 'Říjnová', startsAt: '2099-10-15 19:00:00' }),
			],
		})
		await renderAs('player')
		const first = scrollingRow()
		const second = scrollingRow('Říjnová')
		await user.click(first.button)
		if (method === 'gesto') {
			fireEvent.scroll(second.row, { target: { scrollLeft: 160 } })
		} else {
			await user.click(second.button)
		}
		expect(first.row.scrollLeft).toBe(0)
		expect(first.button).toHaveAttribute('aria-expanded', 'false')
		expect(second.button).toHaveAttribute('aria-expanded', 'true')
		expect(screen.getAllByRole('button', { name: 'Jdu' })).toHaveLength(1)
		await user.click(first.button)
		expect(second.row.scrollLeft).toBe(0)
		expect(second.button).toHaveAttribute('aria-expanded', 'false')
		expect(first.button).toHaveAttribute('aria-expanded', 'true')
		expect(put).not.toHaveBeenCalled()
	})

	it('dobíhající animace zavření znovu neotevře starý řádek', async () => {
		get.mockResolvedValue({ events: [event(), event({ id: 2, title: 'Další' }), event({ id: 3, title: 'Třetí' })] })
		await renderAs('player')
		const first = scrollingRow()
		const second = scrollingRow('Třetí')
		fireEvent.scroll(first.row, { target: { scrollLeft: 160 } })
		first.scrollTo.mockImplementationOnce(() => {})
		fireEvent.scroll(second.row, { target: { scrollLeft: 160 } })
		for (const scrollLeft of [120, 60, 0]) {
			fireEvent.scroll(first.row, { target: { scrollLeft } })
			expect(first.button).toHaveAttribute('aria-expanded', 'false')
			expect(second.button).toHaveAttribute('aria-expanded', 'true')
		}
		fireEvent.scroll(first.row, { target: { scrollLeft: 160 } })
		expect(first.button).toHaveAttribute('aria-expanded', 'true')
		expect(second.row.scrollLeft).toBe(0)
		expect(put).not.toHaveBeenCalled()
	})

	it.each(['yes', 'no'] as const)('uloží %s, zachová poznámku a dopravu a obnoví seznam', async (rsvp) => {
		const user = userEvent.setup()
		const next = event({
			id: 2,
			title: 'Další',
			type: 'match',
			me: {
				...event().me!,
				rsvpNote: 'Přijedu rovnou do haly',
				transport: 'driver',
				carSeats: 3,
			},
		})
		get.mockResolvedValue({ events: [event(), next] })
		put.mockImplementation(async () => {
			const updated = { ...next, me: { ...next.me!, rsvp } }
			get.mockResolvedValue({ events: [event(), updated] })
			return {
				event: updated,
				participants: [],
				canSeeAttendance: false,
				travelFollowerEvents: [],
			} satisfies EventDetail
		})
		await renderAs('player')
		const { button, row } = scrollingRow()
		await user.click(button)
		await user.click(screen.getByRole('button', { name: rsvp === 'yes' ? 'Jdu' : 'Nejdu' }))
		if (rsvp === 'no') {
			// Poznámka u akce slouží jako předvyplněný důvod, hráč ho jen potvrdí.
			expect(screen.getByRole('textbox', { name: 'Důvod omluvy' })).toHaveValue('Přijedu rovnou do haly')
			await user.click(screen.getByRole('button', { name: 'Uložit: nepřijdu' }))
		}
		expect(put).toHaveBeenCalledWith('/events/2/rsvp', {
			rsvp,
			note: 'Přijedu rovnou do haly',
			transport: 'driver',
			carSeats: 3,
		})
		expect(await screen.findByRole('status')).toHaveTextContent(rsvp === 'yes' ? /^Uloženo: jdu$/ : /^Uloženo: nejdu$/)
		await waitFor(() => expect(within(row).getByText(rsvp === 'yes' ? 'Přijdu' : 'Nepřijdu')).toBeInTheDocument())
		expect(button).toHaveAttribute('aria-expanded', 'false')
	})

	it('při chybě ponechá nabídku i původní odpověď a dovolí opakování', async () => {
		const user = userEvent.setup()
		put.mockRejectedValue(new ApiError(409, 'EVENT_STARTED', 'Akce už začala, odpověď se nedá změnit.'))
		await renderAs('player')
		const { button } = scrollingRow()
		await user.click(button)
		await user.click(screen.getByRole('button', { name: 'Jdu' }))
		expect(await screen.findByRole('alert')).toHaveTextContent('Akce už začala')
		expect(button).toHaveAttribute('aria-expanded', 'true')
		expect(screen.getByRole('button', { name: 'Jdu' })).toBeEnabled()
		expect(screen.queryByRole('status')).toBeNull()
	})

	it('během ukládání nepovolí druhou odpověď', async () => {
		const user = userEvent.setup()
		let finish: ((detail: EventDetail) => void) | undefined
		put.mockImplementation(
			() =>
				new Promise<EventDetail>((resolve) => {
					finish = resolve
				}),
		)
		await renderAs('player')
		const { button } = scrollingRow()
		await user.click(button)
		await user.click(screen.getByRole('button', { name: 'Jdu' }))
		expect(screen.getByRole('button', { name: 'Ukládám…' })).toBeDisabled()
		const no = screen.getByRole('button', { name: 'Nejdu' })
		expect(no).toBeDisabled()
		await user.click(no)
		expect(put).toHaveBeenCalledTimes(1)
		await act(async () =>
			finish?.({ event: event({ id: 2 }), participants: [], canSeeAttendance: false, travelFollowerEvents: [] }),
		)
	})

	it('nabídku zpřístupní klávesnicí a Escape ji zavře', async () => {
		const user = userEvent.setup()
		await renderAs('player')
		const { button } = scrollingRow()
		button.focus()
		await user.keyboard('{Enter}')
		expect(screen.getByRole('button', { name: 'Jdu' })).toBeInTheDocument()
		await user.keyboard('{Escape}')
		expect(button).toHaveFocus()
		expect(button).toHaveAttribute('aria-expanded', 'false')
	})

	it('po termínu stále dovolí odpověď a označí prošlý termín', async () => {
		get.mockResolvedValue({
			events: [event(), event({ id: 2, title: 'Další', rsvpDeadlineAt: '2020-01-01 00:00:00' })],
		})
		await renderAs('player')
		expect(screen.getByText('po termínu')).toBeInTheDocument()
		expect(screen.getByRole('button', { name: 'Účast na akci: Další' })).toBeInTheDocument()
	})

	it.each([{ status: 'cancelled' as const }, { me: null }])(
		'nenabídne odpověď pro nepřístupnou akci %j',
		async (overrides) => {
			get.mockResolvedValue({ events: [event(), event({ id: 2, title: 'Další', ...overrides })] })
			await renderAs('player')
			expect(screen.queryByRole('button', { name: 'Účast na akci: Další' })).toBeNull()
		},
	)

	it.each([false, true])('nenabídne odpověď u proběhlé akce (sezóna uzavřená: %s)', async (closed) => {
		const user = userEvent.setup()
		seasonClosed = closed
		get.mockResolvedValue({ events: [event(), event({ id: 2, title: 'Další', started: true })] })
		await renderAs('player')
		await user.click(screen.getByRole('button', { name: 'Proběhlé (1)' }))
		expect(screen.getByRole('link', { name: /Další/ })).toBeInTheDocument()
		expect(screen.queryByRole('button', { name: /Účast na akci/ })).toBeNull()
		seasonClosed = false
	})
	it('nenabídne odpověď na budoucí akci v uzavřené sezóně', async () => {
		seasonClosed = true
		await renderAs('player')
		expect(screen.queryByRole('button', { name: /Účast na akci/ })).toBeNull()
		seasonClosed = false
	})
})
