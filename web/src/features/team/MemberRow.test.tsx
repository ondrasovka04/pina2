import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import type { TeamMember } from '@/lib/types'

import { MemberRow } from './MemberRow'

const member: TeamMember = {
	id: 1,
	userId: 1,
	name: 'Hráč',
	email: 'hrac@example.cz',
	phone: '+420777123456',
	avatarUrl: null,
	role: 'player',
	status: 'active',
	jerseyNumber: null,
	paymentReference: '00010001',
	joinedAt: '2026-09-01 00:00:00',
	hasPassword: true,
}

describe('Telefon člena družstva', () => {
	it('nabídne zavolání bez rozbalování člena', () => {
		render(
			<MemberRow
				member={member}
				members={[member]}
				isMe={false}
				busy={false}
				onChange={vi.fn()}
				onActivate={vi.fn()}
			/>,
		)
		expect(screen.getByRole('link', { name: '+420 777 123 456' })).toHaveAttribute('href', 'tel:+420777123456')
	})

	it('bez čísla nezobrazuje odkaz', () => {
		render(
			<MemberRow
				member={{ ...member, phone: null }}
				members={[member]}
				isMe={false}
				busy={false}
				onChange={vi.fn()}
				onActivate={vi.fn()}
			/>,
		)
		expect(screen.queryByRole('link')).toBeNull()
	})
})
