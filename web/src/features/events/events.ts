import type { EventParticipant, Rsvp, TeamEvent } from '@/lib/types'

/**
 * Doménová logika kalendáře. Drží se mimo komponenty, aby šla testovat bez
 * vykreslování — stejně jako `features/offences/draft.ts`.
 */

/** Zkratky dnů podle iCalendar, v pořadí od pondělí. */
export const weekdays = ['MO', 'TU', 'WE', 'TH', 'FR', 'SA', 'SU'] as const

export type Weekday = (typeof weekdays)[number]

export const weekdayLabels: Record<Weekday, string> = {
	MO: 'po',
	TU: 'út',
	WE: 'st',
	TH: 'čt',
	FR: 'pá',
	SA: 'so',
	SU: 'ne',
}

const weekdayNames: Record<Weekday, string> = {
	MO: 'pondělí',
	TU: 'úterý',
	WE: 'středu',
	TH: 'čtvrtek',
	FR: 'pátek',
	SA: 'sobotu',
	SU: 'neděli',
}

/** „2026-09-15 19:00:00" → `Date`. Safari si mezeru místo „T" přečte jako neplatné datum. */
export function parseDateTime(value: string): Date {
	return new Date(value.replace(' ', 'T'))
}

/** „út 15. 9. 19:00" — den v týdnu je v hale důležitější než rok. */
export function formatEventTime(startsAt: string): string {
	const date = parseDateTime(startsAt)

	if (Number.isNaN(date.getTime())) return startsAt

	return new Intl.DateTimeFormat('cs-CZ', {
		weekday: 'short',
		day: 'numeric',
		month: 'numeric',
		hour: '2-digit',
		minute: '2-digit',
	}).format(date)
}

export function formatTime(value: string): string {
	const date = parseDateTime(value)

	if (Number.isNaN(date.getTime())) return value

	return new Intl.DateTimeFormat('cs-CZ', { hour: '2-digit', minute: '2-digit' }).format(date)
}

export interface EventMonth {
	/** `2026-09`, stabilní klíč pro React. */
	key: string
	label: string
	events: TeamEvent[]
}

/** Kalendář po měsících. Pořadí akcí ze serveru se zachovává. */
export function groupByMonth(events: TeamEvent[]): EventMonth[] {
	const months: EventMonth[] = []

	for (const event of events) {
		const key = event.startsAt.slice(0, 7)
		const last = months.at(-1)

		if (last?.key === key) {
			last.events.push(event)

			continue
		}

		months.push({ key, label: monthLabel(event.startsAt), events: [event] })
	}

	return months
}

function monthLabel(startsAt: string): string {
	const date = parseDateTime(startsAt)

	if (Number.isNaN(date.getTime())) return startsAt.slice(0, 7)

	return new Intl.DateTimeFormat('cs-CZ', { month: 'long', year: 'numeric' }).format(date)
}

/**
 * Odpovídat jde jen do začátku akce a jen u té, která platí. Po začátku je
 * z odpovědi docházka a její změna by byla přepis historie.
 */
export function canAnswer(event: TeamEvent): boolean {
	return !event.started && event.status === 'planned' && event.me !== null
}

/** Nejbližší akce, na kterou se dá ještě odpovědět. */
export function nextEvent(events: TeamEvent[]): TeamEvent | null {
	return events.find((event) => !event.started && event.status === 'planned') ?? null
}

/** „12 přijde · 2 ne · 7 neví" — prázdné části se vynechají. */
export function rsvpSummary(counts: TeamEvent['counts']): string {
	const parts: string[] = []

	if (counts.yes > 0) parts.push(`${counts.yes} přijde`)
	if (counts.no > 0) parts.push(`${counts.no} ne`)
	if (counts.unknown > 0) parts.push(`${counts.unknown} neví`)

	return parts.length === 0 ? 'Zatím nikdo neodpověděl' : parts.join(' · ')
}

/** Kdo veze a kolik má volných míst — podklad pro domluvu odvozů. */
export function driverSummary(participants: EventParticipant[]): string | null {
	const drivers = participants.filter((person) => person.transport === 'driver' && person.rsvp === 'yes')

	if (drivers.length === 0) return null

	const seats = drivers.reduce((total, driver) => total + (driver.carSeats ?? 0), 0)

	return seats === 0
		? `${drivers.length} ${drivers.length === 1 ? 'řidič' : 'řidiči'}`
		: `${drivers.length} ${drivers.length === 1 ? 'řidič' : 'řidiči'}, ${seats} volných míst`
}

/** Procenta účasti. `null` znamená, že se ještě nemá z čeho počítat. */
export function formatRatio(ratio: number | null): string {
	return ratio === null ? '—' : `${Math.round(ratio * 100)} %`
}

/** Zaškrtnuté dny → RRULE. Pořadí dnů je vždy od pondělí, ať se klikalo jakkoli. */
export function buildRrule(days: readonly Weekday[], interval = 1): string {
	const ordered = weekdays.filter((day) => days.includes(day))

	if (ordered.length === 0) return ''

	const every = interval > 1 ? `;INTERVAL=${interval}` : ''

	return `FREQ=WEEKLY${every};BYDAY=${ordered.join(',')}`
}

/** Zpětné čtení pravidla; co nepoznáme, vrátíme jako prázdný výběr. */
export function parseRrule(rrule: string): { days: Weekday[]; interval: number } {
	const parts = new Map<string, string>()

	for (const chunk of rrule.split(';')) {
		const [key, value] = chunk.split('=')
		if (key !== undefined && value !== undefined) parts.set(key.trim().toUpperCase(), value.trim().toUpperCase())
	}

	const byDay = parts.get('BYDAY')?.split(',') ?? []
	const interval = Number.parseInt(parts.get('INTERVAL') ?? '1', 10)

	return {
		days: weekdays.filter((day) => byDay.includes(day)),
		interval: Number.isInteger(interval) && interval > 0 ? interval : 1,
	}
}

/** „každé úterý a čtvrtek v 19:00" — kontrola pravidla lidským okem. */
export function describeRrule(rrule: string, startTime: string): string {
	const { days, interval } = parseRrule(rrule)

	if (days.length === 0) return 'Vyberte aspoň jeden den'

	const names = days.map((day) => weekdayNames[day])
	const listed = names.length === 1 ? names[0] : `${names.slice(0, -1).join(', ')} a ${names.at(-1)}`
	const every = interval === 1 ? 'každé' : `každý ${interval}. týden v`

	return `${every} ${listed} v ${startTime}`
}

/** Odkaz do navigace. Bez souřadnic se hledá podle adresy. */
export function navigationUrl(location: {
	address: string | null
	lat: number | null
	lng: number | null
}): string | null {
	if (location.lat !== null && location.lng !== null) {
		return `https://www.google.com/maps/dir/?api=1&destination=${location.lat},${location.lng}`
	}

	if (location.address !== null && location.address.trim() !== '') {
		return `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(location.address)}`
	}

	return null
}

export const rsvpLabels: Record<Rsvp, string> = {
	yes: 'Přijdu',
	no: 'Nepřijdu',
	unknown: 'Nevím',
}

function pad(part: number): string {
	return String(part).padStart(2, '0')
}

/**
 * Posun času o minuty — z délky akce se tak spočítá konec a ze srazu začátek.
 * Počítá se přes `Date`, takže přechod na letní čas vyjde správně.
 */
export function shiftMinutes(value: string, minutes: number): string {
	const date = parseDateTime(value)

	if (Number.isNaN(date.getTime())) return value

	date.setMinutes(date.getMinutes() + minutes)

	return (
		`${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ` +
		`${pad(date.getHours())}:${pad(date.getMinutes())}`
	)
}

/**
 * Výchozí datum formuláře. Sezóna může začínat v minulosti (rozjela se v září,
 * akce se zakládá v lednu) — pak dává smysl nabídnout dnešek, ne září.
 */
export function todayOrLater(seasonStart: string, today = new Date()): string {
	const iso = `${today.getFullYear()}-${pad(today.getMonth() + 1)}-${pad(today.getDate())}`

	return iso > seasonStart ? iso : seasonStart
}

/** Setřídí účastníky pro zápis docházky: soupiska nahoře, pak podle jména. */
export function sortParticipants(participants: EventParticipant[]): EventParticipant[] {
	return participants.toSorted((a, b) => {
		if (a.onRoster !== b.onRoster) return a.onRoster ? -1 : 1

		return a.name.localeCompare(b.name, 'cs')
	})
}
