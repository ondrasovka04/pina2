import { describe, expect, it } from 'vitest'

import { findAutoRuleConflict } from '@/features/offences/autoRule'
import type { OffenceType } from '@/lib/types'

let nextId = 1

function item(autoRule: string, autoEventType: string, overrides: Partial<OffenceType> = {}): OffenceType {
	return {
		id: nextId++,
		seasonId: 1,
		name: 'Pozdní zápis',
		amountCzk: 50,
		sortOrder: 0,
		category: 'discipline',
		autoRule,
		autoEventType,
		archivedAt: null,
		...overrides,
	}
}

describe('findAutoRuleConflict', () => {
	it('bez pravidla a u cizího pravidla nehlásí nic', () => {
		expect(findAutoRuleConflict([item('late_rsvp', 'any')], 'none', 'any')).toBeNull()
		expect(findAutoRuleConflict([item('excused_absence', 'any')], 'late_rsvp', 'any')).toBeNull()
	})

	it('dvě položky pro tentýž druh akce rozsoudit nejde', () => {
		const conflict = findAutoRuleConflict(
			[item('late_rsvp', 'training', { name: 'Nezapsal se' })],
			'late_rsvp',
			'training',
		)

		expect(conflict).toEqual({ name: 'Nezapsal se', soft: false, otherIsAny: false })
	})

	it('konkrétní druh akce vyhrává nad „u každé akce"', () => {
		expect(findAutoRuleConflict([item('late_rsvp', 'any')], 'late_rsvp', 'training')).toMatchObject({
			soft: true,
			otherIsAny: true,
		})
		expect(findAutoRuleConflict([item('late_rsvp', 'training')], 'late_rsvp', 'any')).toMatchObject({
			soft: true,
			otherIsAny: false,
		})
	})

	// Sazba za trénink a za zápas se liší o stovky, proto tahle dvojice není konflikt.
	it('trénink a zápas si nekonkurují', () => {
		expect(findAutoRuleConflict([item('late_rsvp', 'match')], 'late_rsvp', 'training')).toBeNull()
	})

	it('archivovaná položka se nepočítá', () => {
		const archived = item('late_rsvp', 'any', { archivedAt: '2026-08-01 10:00:00' })

		expect(findAutoRuleConflict([archived], 'late_rsvp', 'training')).toBeNull()
	})
})
