import { describe, expect, it } from 'vitest'

import { describeAuditEntry } from '@/features/team/audit'
import type { AuditEntry } from '@/lib/types'

function entry(overrides: Partial<AuditEntry>): AuditEntry {
	return {
		id: 1,
		action: 'voided',
		entity: 'payment',
		entityId: 10,
		payload: {},
		createdAt: '2026-08-20 12:00:00',
		actor: { id: 1, name: 'Admin' },
		membershipName: null,
		offenceTypeName: null,
		eventTitle: null,
		seasonName: null,
		...overrides,
	}
}

describe('describeAuditEntry', () => {
	it('popíše storno platby včetně důvodu a člena', () => {
		const description = describeAuditEntry(
			entry({ payload: { amountCzk: 480, reason: 'Duplicitní zápis', membershipId: 8 }, membershipName: 'Jan' }),
		)

		expect(description).toContain('Stornoval platbu')
		expect(description).toContain('Jan')
		expect(description).toContain('Důvod: Duplicitní zápis.')
	})

	it('vypíše starou i novou roli', () => {
		expect(
			describeAuditEntry(
				entry({
					action: 'role_changed',
					entity: 'membership',
					payload: { oldRole: 'player', newRole: 'treasurer' },
					membershipName: 'Eva',
				}),
			),
		).toBe('Změnil roli: Eva, hráč → pínař.')
	})

	it('zvládne současnou změnu účtu i sazby', () => {
		const description = describeAuditEntry(
			entry({
				action: 'settings_changed',
				entity: 'team_settings',
				payload: {
					bankAccount: { old: null, new: '19-2000145399/0800' },
					travelRateCzkKm: { old: 5, new: 6.5 },
				},
			}),
		)

		expect(description).toContain('účet: bez účtu → 19-2000145399/0800')
		expect(description).toContain('sazbu cesťáků: 5,00 Kč/km → 6,50 Kč/km')
	})
})
