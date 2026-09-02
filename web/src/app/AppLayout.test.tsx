import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const state = vi.hoisted(() => ({ usesAttendance: true }))

vi.mock('@/app/session', () => ({ useCurrentUser: () => ({ avatarUrl: null }) }))
vi.mock('@/app/TeamSwitcher', () => ({ TeamSwitcher: () => <span>Družstvo</span> }))
vi.mock('@/app/team', () => ({
	useTeam: () => ({
		team: { name: 'Muži', logoUrl: null },
		can: () => true,
		usesAttendance: state.usesAttendance,
		isLoading: false,
		isSeasonLoading: false,
		isSeasonClosed: false,
		error: null,
	}),
}))

const { AppLayout } = await import('@/app/AppLayout')

describe('AppLayout', () => {
	beforeEach(() => {
		state.usesAttendance = true
	})

	it('bez docházky nezobrazí Kalendář v navigaci', () => {
		state.usesAttendance = false
		render(
			<MemoryRouter>
				<AppLayout />
			</MemoryRouter>,
		)

		expect(screen.queryByRole('link', { name: 'Kalendář' })).toBeNull()
		expect(screen.getAllByRole('link', { name: 'Dluhy' })).not.toHaveLength(0)
	})
})
