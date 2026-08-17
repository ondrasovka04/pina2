import { describe, expect, it } from 'vitest'

import type { Season } from '@/lib/types'

import { addYear, nextSeasonName, suggestSeason } from './suggest'

function season(name: string, startsOn: string, endsOn: string): Season {
	return {
		id: 1,
		teamId: 1,
		name,
		startsOn,
		endsOn,
		halfYearOn: null,
		isCurrent: true,
		closedAt: null,
		rosterCount: 0,
	}
}

describe('addYear', () => {
	it('posune datum o rok', () => {
		expect(addYear('2025-09-01')).toBe('2026-09-01')
		expect(addYear('2026-06-30')).toBe('2027-06-30')
	})

	it('z 29. února udělá 28., ne 1. března', () => {
		expect(addYear('2028-02-29')).toBe('2029-02-28')
	})
})

describe('nextSeasonName', () => {
	it('posune ročník', () => {
		expect(nextSeasonName('25/26')).toBe('26/27')
	})

	it('přetočí století', () => {
		expect(nextSeasonName('99/00')).toBe('00/01')
	})

	it('nesrozumitelný název nechá na uživateli', () => {
		expect(nextSeasonName('Kadeti 24/25')).toBeNull()
		expect(nextSeasonName('jaro')).toBeNull()
	})
})

describe('suggestSeason', () => {
	it('jede podle předchozí sezóny', () => {
		// Různé rytmy — datum se posouvá, ne dosazuje.
		expect(suggestSeason(season('25/26', '2025-08-15', '2026-06-30'), '2026-08-16')).toEqual({
			name: '26/27',
			startsOn: '2026-08-15',
			endsOn: '2027-06-30',
		})
	})

	it('u nesrozumitelného názvu nechá název prázdný, období posune', () => {
		const suggestion = suggestSeason(season('Kadeti 24/25', '2024-09-01', '2025-06-30'), '2026-08-16')

		expect(suggestion.name).toBe('')
		expect(suggestion.startsOn).toBe('2025-09-01')
	})

	it('bez předchozí sezóny vyjde z dneška', () => {
		expect(suggestSeason(null, '2026-08-16')).toEqual({
			name: '26/27',
			startsOn: '2026-09-01',
			endsOn: '2027-06-30',
		})
	})

	it('na jaře se počítá minulý ročník', () => {
		expect(suggestSeason(null, '2027-03-04').name).toBe('26/27')
	})
})
