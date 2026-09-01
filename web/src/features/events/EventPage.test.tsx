import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor } from '@testing-library/react'
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
