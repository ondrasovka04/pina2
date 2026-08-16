import { describe, expect, it } from 'vitest'

import { invitationUrl, isLastAdmin, needsActivation, sortMembers } from '@/features/team/members'
import type { MemberStatus, Role, TeamMember } from '@/lib/types'

function member(overrides: Partial<TeamMember> & { id: number; name: string }): TeamMember {
	return {
		userId: overrides.id,
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
			member({ id: 2, name: 'Bořek', status: 'suspended' }),
			member({ id: 3, name: 'Adam' }),
		])

		expect(sorted.map((item) => item.name)).toEqual(['Adam', 'Bořek', 'Cyril'])
	})

	it('v rámci stejného stavu řadí česky podle jména', () => {
		const sorted = sortMembers([
			member({ id: 1, name: 'Žofie' }),
			member({ id: 2, name: 'Šimon' }),
			member({ id: 3, name: 'Svatava' }),
		])

		// Bez české kolace by „Šimon" spadl za „Žofie" — v ASCII je Š až za Z.
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

	it('odešlého admina nepočítá jako náhradu', () => {
		const gone = member({ id: 2, name: 'Petr', role: 'admin', status: 'left' })

		expect(isLastAdmin(admin, [admin, gone])).toBe(true)
	})

	it('pozastavený admin jako náhrada stačí — roli má pořád', () => {
		const suspended = member({ id: 2, name: 'Petr', role: 'admin', status: 'suspended' })

		expect(isLastAdmin(admin, [admin, suspended])).toBe(false)
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
