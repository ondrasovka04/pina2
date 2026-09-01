import { describe, expect, it } from 'vitest'

import type { TeamEvent } from '@/lib/types'

import { monthGrid, monthsWithEvents, monthTitle, shiftMonth } from './month'

function event(overrides: Partial<TeamEvent> = {}): TeamEvent {
	return {
		id: 1,
		seasonId: 1,
		seriesId: null,
		type: 'training',
		title: 'Trénink',
		startsAt: '2026-09-15 19:00:00',
		endsAt: null,
		meetAt: null,
		location: null,
		opponent: null,
		note: null,
		distanceKm: null,
		rsvpDeadlineAt: null,
		rsvpDeadlineCustom: null,
		status: 'planned',
		isHome: null,
		overridden: false,
		started: false,
		rosterCount: 10,
		counts: { yes: 0, no: 0, unknown: 0 },
		me: null,
		...overrides,
	}
}

describe('monthGrid', () => {
	it('u měsíce, který začíná pondělkem, nepřidává dny před 1. dnem', () => {
		// Červen 2026 začíná v pondělí.
		const weeks = monthGrid('2026-06', [])

		expect(weeks[0]?.days[0]?.date).toBe('2026-06-01')
		expect(weeks[0]?.days[0]?.inMonth).toBe(true)
	})

	it('u měsíce, který začíná nedělí, dobije celý předchozí týden', () => {
		// Březen 2026 začíná v neděli.
		const weeks = monthGrid('2026-03', [])

		expect(weeks[0]?.days[0]?.date).toBe('2026-02-23')
		expect(weeks[0]?.days[0]?.inMonth).toBe(false)
		expect(weeks[0]?.days[6]?.date).toBe('2026-03-01')
		expect(weeks[0]?.days[6]?.inMonth).toBe(true)
	})

	it('má vždy celé týdny', () => {
		for (const week of monthGrid('2026-03', [])) {
			expect(week.days).toHaveLength(7)
		}
	})

	it('přesahuje do sousedního měsíce na obou koncích', () => {
		// Září 2026 začíná v úterý a končí ve středu.
		const weeks = monthGrid('2026-09', [])
		const allDays = weeks.flatMap((week) => week.days)

		expect(allDays[0]?.date).toBe('2026-08-31')
		expect(allDays[0]?.inMonth).toBe(false)
		expect(allDays.at(-1)?.date).toBe('2026-10-04')
		expect(allDays.at(-1)?.inMonth).toBe(false)
	})

	it('zvládne přestupný únor', () => {
		const weeks = monthGrid('2024-02', [])
		const allDays = weeks.flatMap((week) => week.days)
		const inMonthDates = allDays.filter((day) => day.inMonth).map((day) => day.date)

		expect(inMonthDates[0]).toBe('2024-02-01')
		expect(inMonthDates.at(-1)).toBe('2024-02-29')
		expect(inMonthDates).toHaveLength(29)
	})

	it('zvládne neproběhlý únor', () => {
		const weeks = monthGrid('2023-02', [])
		const allDays = weeks.flatMap((week) => week.days)
		const inMonthDates = allDays.filter((day) => day.inMonth).map((day) => day.date)

		expect(inMonthDates.at(-1)).toBe('2023-02-28')
		expect(inMonthDates).toHaveLength(28)
	})

	it('přiřadí akce do správného dne podle startsAt bez převodu přes Date', () => {
		const events = [
			event({ id: 1, startsAt: '2026-09-05 19:00:00' }),
			event({ id: 2, startsAt: '2026-09-05 08:00:00' }),
			event({ id: 3, startsAt: '2026-09-06 19:00:00' }),
		]

		const weeks = monthGrid('2026-09', events)
		const allDays = weeks.flatMap((week) => week.days)
		const day5 = allDays.find((day) => day.date === '2026-09-05')
		const day6 = allDays.find((day) => day.date === '2026-09-06')

		// V rámci dne jsou seřazené podle času.
		expect(day5?.events.map((item) => item.id)).toEqual([2, 1])
		expect(day6?.events.map((item) => item.id)).toEqual([3])
	})

	it('den bez akcí má prázdné pole', () => {
		const weeks = monthGrid('2026-09', [])

		expect(weeks[0]?.days[0]?.events).toEqual([])
	})

	it('pozná dnešek podle volitelného parametru', () => {
		const weeks = monthGrid('2026-09', [], new Date(2026, 8, 15))
		const allDays = weeks.flatMap((week) => week.days)

		expect(allDays.filter((day) => day.isToday).map((day) => day.date)).toEqual(['2026-09-15'])
	})

	it('bez shody s dneškem není žádný den označený', () => {
		const weeks = monthGrid('2026-09', [], new Date(2020, 0, 1))
		const allDays = weeks.flatMap((week) => week.days)

		expect(allDays.some((day) => day.isToday)).toBe(false)
	})
})

describe('monthsWithEvents', () => {
	it('vrátí měsíce vzestupně a bez duplicit', () => {
		const events = [
			event({ id: 1, startsAt: '2026-10-01 19:00:00' }),
			event({ id: 2, startsAt: '2026-09-01 19:00:00' }),
			event({ id: 3, startsAt: '2026-09-20 19:00:00' }),
		]

		expect(monthsWithEvents(events)).toEqual(['2026-09', '2026-10'])
	})

	it('na prázdný vstup vrátí prázdné pole', () => {
		expect(monthsWithEvents([])).toEqual([])
	})
})

describe('monthTitle', () => {
	it('vrátí název měsíce s rokem', () => {
		expect(monthTitle('2026-09')).toBe('září 2026')
	})
})

describe('shiftMonth', () => {
	it('posune o měsíc dopředu přes přelom roku', () => {
		expect(shiftMonth('2026-12', 1)).toBe('2027-01')
	})

	it('posune o měsíc zpátky přes přelom roku', () => {
		expect(shiftMonth('2027-01', -1)).toBe('2026-12')
	})

	it('posune uvnitř roku oběma směry', () => {
		expect(shiftMonth('2026-09', 1)).toBe('2026-10')
		expect(shiftMonth('2026-09', -1)).toBe('2026-08')
	})
})
