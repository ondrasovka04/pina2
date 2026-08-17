import { describe, expect, it } from 'vitest'

import { itemsInPeriod, memberBalance, memberRecordCount, periodByKey, teamSums } from '@/features/balances/period'
import type { BalanceList, BalancePeriod, BalanceSums, MemberBalance } from '@/lib/types'

function sums(overrides: Partial<BalanceSums> = {}): BalanceSums {
	return { offencesCzk: 0, bonusesCzk: 0, paidCzk: 0, travelCzk: 0, balanceCzk: 0, recordCount: 0, ...overrides }
}

function member(overrides: Partial<MemberBalance> = {}): MemberBalance {
	return {
		membershipId: 1,
		userId: 1,
		name: 'Kindrák',
		jerseyNumber: null,
		status: 'active',
		onRoster: true,
		recordCount: 3,
		offencesCzk: 240,
		bonusesCzk: -50,
		paidCzk: 100,
		travelCzk: 0,
		balanceCzk: 90,
		halves: {
			first: sums({ offencesCzk: 200, bonusesCzk: -50, balanceCzk: 150, recordCount: 2 }),
			second: sums({ offencesCzk: 40, paidCzk: 100, balanceCzk: -60, recordCount: 1 }),
		},
		...overrides,
	}
}

const periods: BalancePeriod[] = [
	{ key: 'all', label: 'Celá sezóna', from: '2026-09-01', to: '2027-06-30' },
	{ key: 'first', label: '1. pololetí', from: '2026-09-01', to: '2026-12-31' },
	{ key: 'second', label: '2. pololetí', from: '2027-01-01', to: '2027-06-30' },
]

describe('pololetí', () => {
	it('zůstatek hráče se bere z vybrané poloviny', () => {
		expect(memberBalance(member(), 'all')).toBe(90)
		expect(memberBalance(member(), 'first')).toBe(150)
		expect(memberBalance(member(), 'second')).toBe(-60)
	})

	it('ploché hodnoty jsou součtem obou polovin', () => {
		const m = member()

		expect(m.halves).not.toBeNull()
		expect((m.halves?.first.balanceCzk ?? 0) + (m.halves?.second.balanceCzk ?? 0)).toBe(m.balanceCzk)
	})

	it('bez nastaveného přelomu padá všechno na celou sezónu', () => {
		const withoutHalves = member({ halves: null })

		expect(memberBalance(withoutHalves, 'first')).toBe(90)
		expect(memberRecordCount(withoutHalves, 'second')).toBe(3)
	})

	it('počet zápisů se dělí podle pololetí', () => {
		expect(memberRecordCount(member(), 'first')).toBe(2)
		expect(memberRecordCount(member(), 'second')).toBe(1)
	})

	it('součty družstva respektují vybrané období', () => {
		const data = {
			totals: sums({ balanceCzk: 90, paidCzk: 100 }),
			halves: {
				first: sums({ balanceCzk: 150 }),
				second: sums({ balanceCzk: -60, paidCzk: 100 }),
			},
		} as BalanceList

		expect(teamSums(data, 'all').balanceCzk).toBe(90)
		expect(teamSums(data, 'first').balanceCzk).toBe(150)
		expect(teamSums(data, 'second').paidCzk).toBe(100)
	})

	it('datované položky se filtrují včetně krajních dnů', () => {
		const items = [{ on: '2026-12-31' }, { on: '2027-01-01' }, { on: '2027-06-30' }]
		const only = (key: 'all' | 'first' | 'second') =>
			itemsInPeriod(items, (item) => item.on, periodByKey(periods, key)).map((item) => item.on)

		expect(only('first')).toEqual(['2026-12-31'])
		expect(only('second')).toEqual(['2027-01-01', '2027-06-30'])
		expect(only('all')).toHaveLength(3)
	})

	it('neznámé období nefiltruje nic, aby se peníze nikdy neschovaly', () => {
		const items = [{ on: '2026-12-31' }]

		expect(itemsInPeriod(items, (item) => item.on, undefined)).toHaveLength(1)
	})
})
