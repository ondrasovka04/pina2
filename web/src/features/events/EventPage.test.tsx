import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { StrictMode } from 'react'
import { MemoryRouter, Route, Routes } from 'react-router'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { EventDetail, EventParticipant, Role, TeamEvent } from '@/lib/types'

// Admin u zápasu je nejhustší varianta: vedle vlastní odpovědi se vykreslí
// i nominace, takže se pozná, jestli si karty navzájem nelezou do zelí.
const teamValue = {
	seasonId: 10,
	isSeasonClosed: false,
	can: (_required: Role) => true,
}

vi.mock('@/app/team', () => ({ useTeam: () => teamValue }))

const get = vi.fn()
const put = vi.fn()

vi.mock('@/lib/api', async (importOriginal) => {
	const actual = await importOriginal<typeof import('@/lib/api')>()

	return { ...actual, api: { ...actual.api, get, put } }
})

const { EventPage } = await import('@/features/events/EventPage')

function detail(overrides: Partial<TeamEvent> = {}, participantOverrides: Partial<EventParticipant> = {}): EventDetail {
	return {
		event: {
			id: 10,
			seasonId: 10,
			seriesId: null,
			type: 'match',
			title: 'Zápas s Benátkami',
			startsAt: '2026-08-22 10:00:00',
			endsAt: null,
			meetAt: null,
			location: null,
			opponent: 'VK Benátky',
			note: null,
			distanceKm: 52,
			travelLinkEvent: null,
			rsvpDeadlineAt: null,
			rsvpDeadlineCustom: null,
			status: 'planned',
			isHome: false,
			started: false,
			overridden: false,
			rosterCount: 2,
			counts: { yes: 1, no: 0, unknown: 1 },
			me: {
				membershipId: 2,
				rsvp: 'yes',
				rsvpNote: null,
				rsvpAt: null,
				rsvpLate: false,
				nomination: 'none',
				transport: 'none',
				carSeats: null,
				attendance: null,
			},
			...overrides,
		},
		participants: [
			{
				membershipId: 2,
				userId: 1,
				name: 'Ondra',
				avatarUrl: null,
				jerseyNumber: 7,
				onRoster: true,
				nomination: 'none',
				rsvp: 'yes',
				rsvpNote: null,
				rsvpAt: null,
				rsvpLate: false,
				transport: 'none',
				carSeats: null,
				attendance: null,
				corrected: false,
				...participantOverrides,
			},
		],
		canSeeAttendance: true,
		travelFollowerEvents: [],
	}
}

function renderPage() {
	const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })

	return render(
		<StrictMode>
			<QueryClientProvider client={client}>
				<MemoryRouter initialEntries={['/akce/10']}>
					<Routes>
						<Route path="/akce/:eventId" element={<EventPage />} />
					</Routes>
				</MemoryRouter>
			</QueryClientProvider>
		</StrictMode>,
	)
}

describe('EventPage', () => {
	beforeEach(() => {
		get.mockReset()
		put.mockReset()
		get.mockResolvedValue(detail())
	})

	it.each([
		{ started: false, index: 0 },
		{ started: false, index: 1 },
		{ started: true, index: 0 },
		{ started: true, index: 1 },
		{ started: true, index: 2 },
	])('otevře profilovku v sekci $index (akce začala: $started)', async ({ started, index }) => {
		const user = userEvent.setup()
		get.mockResolvedValue(detail({ started }, { avatarUrl: '/avatar.png' }))
		renderPage()
		const triggers = await screen.findAllByRole('button', { name: 'Zvětšit profilovou fotku: Ondra' })
		expect(triggers).toHaveLength(started ? 3 : 2)
		const trigger = triggers[index]
		if (trigger === undefined) throw new Error('Chybí tlačítko profilové fotky')
		await user.click(trigger)
		const dialog = screen.getByRole('dialog', { name: 'Ondra' })
		expect(within(dialog).getByRole('img')).toHaveAttribute('src', '/avatar.png')
		await user.click(within(dialog).getByRole('button', { name: 'Zavřít náhled' }))
	})

	it('změnu účasti po termínu odešle až po potvrzení a nezamění ji za uložení poznámky', async () => {
		const user = userEvent.setup()
		const late = detail({ rsvpDeadlineAt: '2020-01-01 00:00:00' })
		get.mockResolvedValue(late)
		put.mockResolvedValue(late)
		renderPage()
		await screen.findByRole('heading', { name: 'Moje odpověď' })
		await user.type(screen.getByRole('textbox', { name: 'Poznámka' }), 'Nestíhám')
		await user.click(screen.getByRole('button', { name: 'Nepřijdu' }))
		const modal = screen.getByRole('dialog', { name: 'Změnit účast po termínu?' })
		expect(put).not.toHaveBeenCalled()
		await user.click(within(modal).getByRole('button', { name: 'Zrušit' }))
		expect(put).not.toHaveBeenCalled()
		expect(screen.getByRole('button', { name: 'Přijdu' })).toHaveAttribute('aria-pressed', 'true')
		await user.click(screen.getByRole('button', { name: 'Nepřijdu' }))
		await user.click(within(modal).getByRole('button', { name: 'Ano, uložit změnu' }))
		await waitFor(() => expect(put).toHaveBeenCalledTimes(1))
		expect(put).toHaveBeenCalledWith('/events/10/rsvp', expect.objectContaining({ rsvp: 'no', note: 'Nestíhám' }))
	})

	it('po termínu varuje i před uložením samotné poznámky', async () => {
		const user = userEvent.setup()
		get.mockResolvedValue(detail({ rsvpDeadlineAt: '2020-01-01 00:00:00' }))
		renderPage()
		await user.type(await screen.findByRole('textbox', { name: 'Poznámka' }), 'Nová poznámka')
		await user.tab()
		expect(screen.getByRole('dialog', { name: 'Změnit účast po termínu?' })).toBeInTheDocument()
		expect(put).not.toHaveBeenCalled()
	})

	it('má právě jednu sekci s vlastní odpovědí', async () => {
		renderPage()

		await screen.findByRole('heading', { name: 'Moje odpověď' })

		expect(screen.getAllByRole('heading', { name: 'Moje odpověď' })).toHaveLength(1)
		expect(screen.queryByText(/po termínu|Zapsáno pozdě/)).toBeNull()
	})

	it('u akce bez termínu nevykreslí odznak ani nad starším snapshotem', async () => {
		const me = { ...detail().event.me!, rsvpLate: true }
		get.mockResolvedValue(detail({ rsvpDeadlineAt: null, me }, { rsvpLate: true }))

		renderPage()
		await screen.findByRole('heading', { name: 'Moje odpověď' })

		expect(screen.queryByText(/po termínu|Zapsáno pozdě|pozdě/)).toBeNull()
	})

	it('po uplynutí termínu označí vlastní chybějící odpověď i řádek hráče', async () => {
		const me = { ...detail().event.me!, rsvp: 'unknown' as const }
		get.mockResolvedValue(detail({ rsvpDeadlineAt: '2020-09-15 18:00:00', me }, { rsvp: 'unknown', rsvpLate: false }))

		renderPage()

		expect(await screen.findByText(/Termín už uplynul/)).toBeInTheDocument()
		expect(screen.getAllByText('po termínu').length).toBeGreaterThan(0)
	})

	it('výslovně označí pozdní uloženou odpověď', async () => {
		const me = { ...detail().event.me!, rsvpLate: true }
		get.mockResolvedValue(detail({ rsvpDeadlineAt: '2020-09-15 18:00:00', me }, { rsvpLate: true }))

		renderPage()

		expect(await screen.findByText('Zapsáno pozdě')).toBeInTheDocument()
		expect(screen.getByText('pozdě')).toBeInTheDocument()
	})

	it('u napojené akce dvojzápasu ukáže, kde se nastavují auta, a schová vlastní volbu dopravy', async () => {
		get.mockResolvedValue(detail({ travelLinkEvent: { id: 5, title: 'Zápas 1' } }))

		renderPage()

		expect(await screen.findAllByText(/Auta.*se (domlouvají|nastavují) u akce/)).not.toHaveLength(0)
		for (const link of screen.getAllByRole('link', { name: 'Zápas 1' })) {
			expect(link).toHaveAttribute('href', '/akce/5')
		}
		expect(screen.queryByRole('button', { name: 'Beru auto' })).toBeNull()
	})

	it('u hlavní akce dvojzápasu ukáže, za koho ještě platí cesťák', async () => {
		get.mockResolvedValue({ ...detail(), travelFollowerEvents: [{ id: 11, title: 'Zápas 2' }] })

		renderPage()

		expect(await screen.findByText(/Cesťák platí i za/)).toBeInTheDocument()
		expect(screen.getByRole('link', { name: 'Zápas 2' })).toHaveAttribute('href', '/akce/11')
	})

	it('po uložení odpovědi sekci nezdvojí', async () => {
		const user = userEvent.setup()
		put.mockImplementation(() => Promise.resolve(detail({ me: { ...detail().event.me!, rsvp: 'no' } })))

		renderPage()
		await screen.findByRole('heading', { name: 'Moje odpověď' })

		await user.click(screen.getByRole('button', { name: /Nepřijdu/ }))

		await waitFor(() => expect(put).toHaveBeenCalled())

		expect(screen.getAllByRole('heading', { name: 'Moje odpověď' })).toHaveLength(1)
		expect(screen.getAllByRole('heading', { name: 'Kdo přijde' })).toHaveLength(1)
	})
})
