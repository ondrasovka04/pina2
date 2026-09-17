import type { TeamEvent } from '@/lib/types'

/**
 * Doménová logika měsíční mřížky, mimo komponenty stejně jako `events.ts`. Datum akce se
 * čte z `startsAt.slice(0, 10)`, ne přes `Date` — ten by u půlnočních akcí posunul den.
 */

export interface CalendarCell {
	/** `RRRR-MM-DD`. */
	date: string
	/** Patří den do zobrazovaného měsíce, nebo je to dobitý den ze sousedního? */
	inMonth: boolean
	isToday: boolean
	events: TeamEvent[]
}

export interface CalendarWeek {
	/** Datum pondělí daného týdne — stabilní klíč pro React. */
	key: string
	days: CalendarCell[]
}

function pad(part: number): string {
	return String(part).padStart(2, '0')
}

function toIso(date: Date): string {
	return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
}

function parseMonth(month: string): { year: number; monthIndex: number } {
	const [yearPart, monthPart] = month.split('-')

	return { year: Number(yearPart), monthIndex: Number(monthPart) - 1 }
}

/** Pondělí = 0, neděle = 6 — na rozdíl od `Date.getDay()`, kde je neděle 0. */
function mondayIndex(date: Date): number {
	return (date.getDay() + 6) % 7
}

/** Mřížka celého měsíce včetně dobitých dnů ze sousedních měsíců. Týden začíná pondělkem. */
export function monthGrid(month: string, events: TeamEvent[], today: Date = new Date()): CalendarWeek[] {
	const { year, monthIndex } = parseMonth(month)
	const firstOfMonth = new Date(year, monthIndex, 1)
	const lastOfMonth = new Date(year, monthIndex + 1, 0)

	const leading = mondayIndex(firstOfMonth)
	// Počet týdnů se spočítá dopředu; dny pak vyrábí konstruktor Date, který si poradí
	// i s přechodem na letní čas a s přetečením do dalšího měsíce.
	const weekCount = Math.ceil((leading + lastOfMonth.getDate()) / 7)

	const eventsByDate = new Map<string, TeamEvent[]>()
	for (const event of events) {
		const date = event.startsAt.slice(0, 10)
		const list = eventsByDate.get(date)

		if (list === undefined) {
			eventsByDate.set(date, [event])
		} else {
			list.push(event)
		}
	}

	for (const [date, list] of eventsByDate) {
		eventsByDate.set(
			date,
			list.toSorted((a, b) => a.startsAt.localeCompare(b.startsAt)),
		)
	}

	const todayIso = toIso(today)
	const weeks: CalendarWeek[] = []

	for (let week = 0; week < weekCount; week++) {
		const days: CalendarCell[] = []

		for (let day = 0; day < 7; day++) {
			const date = new Date(year, monthIndex, 1 - leading + week * 7 + day)
			const iso = toIso(date)

			days.push({
				date: iso,
				inMonth: date.getMonth() === monthIndex && date.getFullYear() === year,
				isToday: iso === todayIso,
				events: eventsByDate.get(iso) ?? [],
			})
		}

		weeks.push({ key: days[0]?.date ?? String(week), days })
	}

	return weeks
}

/** „září 2026" */
export function monthTitle(month: string): string {
	const { year, monthIndex } = parseMonth(month)
	const date = new Date(year, monthIndex, 1)

	return new Intl.DateTimeFormat('cs-CZ', { month: 'long', year: 'numeric' }).format(date)
}

/** Posun o měsíce: („2026-12", 1) → „2027-01". */
export function shiftMonth(month: string, by: number): string {
	const { year, monthIndex } = parseMonth(month)
	const date = new Date(year, monthIndex + by, 1)

	return `${date.getFullYear()}-${pad(date.getMonth() + 1)}`
}
