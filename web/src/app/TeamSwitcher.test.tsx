import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { Role } from '@/lib/types'

const roles: Role[] = ['player', 'treasurer', 'admin']

let role: Role = 'player'

const teamValue = {
	teams: [{ id: 4, name: 'Muži', clubId: 1, clubName: 'SK Prosek' }],
	team: { id: 4, name: 'Muži', clubId: 1, clubName: 'SK Prosek' },
	seasons: [{ id: 10, name: '26/27', isCurrent: true, closedAt: null }],
	season: { id: 10, name: '26/27', isCurrent: true, closedAt: null },
	selectTeam: vi.fn(),
	selectSeason: vi.fn(),
	usesAttendance: true,
	can: (needed: Role) => roles.indexOf(role) >= roles.indexOf(needed),
}

vi.mock('@/app/team', () => ({ useTeam: () => teamValue }))
vi.mock('@/app/session', () => ({ useCurrentUser: () => ({ platformAdmin: false }) }))

const { TeamSwitcher } = await import('@/app/TeamSwitcher')

async function openPanel(as: Role) {
	role = as

	const user = userEvent.setup()
	render(
		<MemoryRouter>
			<TeamSwitcher />
		</MemoryRouter>,
	)

	const trigger = screen.queryByRole('button', { expanded: false })
	if (trigger !== null) await user.click(trigger)
}

describe('TeamSwitcher — kudy se kdo dostane ke správě', () => {
	beforeEach(() => {
		teamValue.usesAttendance = true
	})

	it('hráč nemá co přepínat ani spravovat, panel se vůbec neotevírá', async () => {
		await openPanel('player')

		expect(screen.queryByRole('button')).toBeNull()
		expect(screen.queryByText('Sezóny a soupiska')).toBeNull()
	})

	it('pínař se dostane na sezóny, série i místa', async () => {
		await openPanel('treasurer')

		expect(screen.getByRole('link', { name: 'Sezóny a soupiska' })).toBeInTheDocument()
		expect(screen.getByRole('link', { name: 'Opakované akce' })).toBeInTheDocument()
		expect(screen.getByRole('link', { name: 'Spravovat místa' })).toBeInTheDocument()
		// Členové a role zůstávají adminovi.
		expect(screen.queryByText('Spravovat družstva')).toBeNull()
	})

	it('admin má navíc správu družstva', async () => {
		await openPanel('admin')

		expect(screen.getByRole('link', { name: 'Spravovat družstva' })).toBeInTheDocument()
		expect(screen.getByRole('link', { name: 'Sezóny a soupiska' })).toBeInTheDocument()
	})

	it('bez docházky skryje správu sérií a míst', async () => {
		teamValue.usesAttendance = false
		await openPanel('treasurer')

		expect(screen.queryByRole('link', { name: 'Opakované akce' })).toBeNull()
		expect(screen.queryByRole('link', { name: 'Spravovat místa' })).toBeNull()
	})
})
