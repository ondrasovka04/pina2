import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
	useCalendarFeeds: vi.fn(),
	revoke: vi.fn(),
	issue: vi.fn(),
}))

vi.mock('@/app/team', () => ({
	useTeam: () => ({
		teams: [{ id: 4, name: 'Muži', attendanceEnabled: true, currentSeason: { id: 10, name: '26/27' } }],
	}),
}))

vi.mock('@/lib/queries', () => ({
	useCalendarFeeds: mocks.useCalendarFeeds,
	useIssueCalendarFeed: () => ({ mutateAsync: mocks.issue, reset: vi.fn(), isPending: false, error: null }),
	useRevokeCalendarFeed: () => ({ mutateAsync: mocks.revoke, isPending: false, error: null }),
}))

const { CalendarFeedsCard } = await import('@/features/profile/CalendarFeedsCard')

const feed = {
	id: 8,
	teamId: 4,
	teamName: 'Muži',
	seasonId: 10,
	seasonName: '26/27',
	createdAt: '2026-08-17 12:00:00',
	lastUsedAt: null,
}

describe('CalendarFeedsCard', () => {
	beforeEach(() => {
		mocks.revoke.mockReset()
		mocks.issue.mockReset()
		mocks.revoke.mockResolvedValue(undefined)
		mocks.useCalendarFeeds.mockReturnValue({ data: [feed], isPending: false, error: null })
	})

	it('ukáže aktivní odběr bez tajné adresy a dovolí ho zneplatnit', async () => {
		const user = userEvent.setup()
		render(<CalendarFeedsCard />)

		expect(screen.getByText(/Aktivní od/)).toBeInTheDocument()
		expect(screen.queryByLabelText('Adresa odběru')).toBeNull()

		await user.click(screen.getByRole('button', { name: 'Zneplatnit' }))
		await user.click(screen.getAllByRole('button', { name: 'Zneplatnit' }).at(-1)!)

		expect(mocks.revoke).toHaveBeenCalledWith(8)
	})

	/**
	 * Adresa se ukazuje jen jednou. Řádek se po vydání překlíčuje ze „sezóna bez
	 * odběru" na „odběr", takže ho React odmontuje — dialog to nesmí vzít s sebou.
	 */
	it('nechá tajnou adresu na obrazovce i po překreslení seznamu odběrů', async () => {
		const user = userEvent.setup()
		const token = 'a'.repeat(64)
		mocks.useCalendarFeeds.mockReturnValue({ data: [], isPending: false, error: null })
		mocks.issue.mockResolvedValue({ ...feed, token })

		const { rerender } = render(<CalendarFeedsCard />)
		await user.click(screen.getByRole('button', { name: 'Vytvořit odběr' }))

		expect(mocks.issue).toHaveBeenCalledWith(10)
		expect(screen.getByLabelText('Adresa odběru')).toHaveValue(`webcal://localhost:3000/api/v1/calendar/${token}.ics`)

		// Dorazil zneplatněný seznam odběrů: řádek „sezóna bez odběru" zmizí
		// a nastoupí řádek odběru s jiným `key`. Tohle naživo dělá invalidace
		// dotazu a právě tady dialog s adresou dřív zmizel.
		mocks.useCalendarFeeds.mockReturnValue({ data: [feed], isPending: false, error: null })
		rerender(<CalendarFeedsCard />)

		expect(screen.getByText(/Aktivní od/)).toBeInTheDocument()
		expect(screen.getByLabelText('Adresa odběru')).toHaveValue(`webcal://localhost:3000/api/v1/calendar/${token}.ics`)
	})
})
