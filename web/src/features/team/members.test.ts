import { describe, expect, it } from 'vitest'

import { describeBatch, invitationUrl, isLastAdmin, needsActivation, sortMembers } from '@/features/team/members'
import type { MemberStatus, Role, TeamMember } from '@/lib/types'

function member(overrides: Partial<TeamMember> & { id: number; name: string }): TeamMember {
	return {
		userId: overrides.id,
		avatarUrl: null,
		email: `${overrides.name}@prosek.cz`,
		role: 'player' as Role,
		status: 'active' as MemberStatus,
		jerseyNumber: null,
		paymentReference: '0010001',
		joinedAt: '2026-01-01 00:00:00',
		hasPassword: true,
		...overrides,
	}
}

describe('sortMembers', () => {
	it('řadí aktivní nahoru a odešlé dolů', () => {
		const sorted = sortMembers([
			member({ id: 1, name: 'Cyril', status: 'left' }),
			member({ id: 2, name: 'Adam', status: 'left' }),
			member({ id: 3, name: 'Bořek' }),
		])

		expect(sorted.map((item) => item.name)).toEqual(['Bořek', 'Adam', 'Cyril'])
	})

	it('v rámci stejného stavu řadí česky podle jména', () => {
		const sorted = sortMembers([
			member({ id: 1, name: 'Žofie' }),
			member({ id: 2, name: 'Šimon' }),
			member({ id: 3, name: 'Svatava' }),
		])

		// Česká kolace — ASCII by dal Š za Z.
		expect(sorted.map((item) => item.name)).toEqual(['Svatava', 'Šimon', 'Žofie'])
	})

	it('nemění vstupní pole', () => {
		const input = [member({ id: 1, name: 'Béta' }), member({ id: 2, name: 'Alfa' })]
		sortMembers(input)

		expect(input.map((item) => item.name)).toEqual(['Béta', 'Alfa'])
	})
})

describe('needsActivation', () => {
	it('platí pro člena bez hesla', () => {
		expect(needsActivation(member({ id: 1, name: 'Adam', hasPassword: false }))).toBe(true)
	})

	it('neplatí pro toho, kdo už heslo má', () => {
		expect(needsActivation(member({ id: 1, name: 'Adam' }))).toBe(false)
	})

	it('neplatí pro toho, kdo z družstva odešel', () => {
		expect(needsActivation(member({ id: 1, name: 'Adam', hasPassword: false, status: 'left' }))).toBe(false)
	})
})

describe('isLastAdmin', () => {
	const admin = member({ id: 1, name: 'Ondra', role: 'admin' })

	it('pozná jediného admina', () => {
		expect(isLastAdmin(admin, [admin, member({ id: 2, name: 'Petr', role: 'treasurer' })])).toBe(true)
	})

	it('při dvou adminech neplatí ani pro jednoho', () => {
		const second = member({ id: 2, name: 'Petr', role: 'admin' })

		expect(isLastAdmin(admin, [admin, second])).toBe(false)
		expect(isLastAdmin(second, [admin, second])).toBe(false)
	})

	it('odešlého admina nepočítá', () => {
		const gone = member({ id: 2, name: 'Petr', role: 'admin', status: 'left' })

		expect(isLastAdmin(admin, [admin, gone])).toBe(true)
	})

	it('u odešlého člena neplatí, i když měl roli admina', () => {
		const gone = member({ id: 1, name: 'Ondra', role: 'admin', status: 'left' })

		expect(isLastAdmin(gone, [gone])).toBe(false)
	})
})

describe('invitationUrl', () => {
	it('skládá absolutní odkaz s tokenem', () => {
		expect(invitationUrl('abc123', 'https://pinaprosek.eu')).toBe('https://pinaprosek.eu/pozvanka?token=abc123')
	})

	it('escapuje token, aby ho nerozbil žádný znak', () => {
		expect(invitationUrl('a+b/c=', 'https://pinaprosek.eu')).toBe('https://pinaprosek.eu/pozvanka?token=a%2Bb%2Fc%3D')
	})
})

describe('describeBatch', () => {
	it('po úspěšném dokončení hlásí hotovo', () => {
		expect(describeBatch({ sent: 6, failed: 0, remaining: 0, skipped: 0 })).toBe('Odesláno 6. Hotovo.')
	})

	it('u nedokončené dávky vyzve k dalšímu kliknutí', () => {
		expect(describeBatch({ sent: 25, failed: 0, remaining: 65, skipped: 0 })).toBe(
			'Odesláno 25. Zbývá 65 — zmáčkněte znovu.',
		)
	})

	it('nehlásí hotovo, když část zpráv neodešla', () => {
		// Neodeslané se zkusí znovu při dalším kliknutí, patří tedy do „zbývá".
		expect(describeBatch({ sent: 0, failed: 19, remaining: 0, skipped: 0 })).toBe(
			'Odesláno 0, 19 neodešlo. Zbývá 19 — zmáčkněte znovu.',
		)
	})

	it('účty bez adresy zmíní, ale nepočítá je mezi zbývající', () => {
		// Ty se samy nespraví, admin jim musí doplnit e-mail.
		expect(describeBatch({ sent: 3, failed: 0, remaining: 0, skipped: 2 })).toBe(
			'Odesláno 3, 2 bez použitelné adresy. Hotovo.',
		)
	})
})
