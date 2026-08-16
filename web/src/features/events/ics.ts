import type { EventLocation, TeamEvent } from '@/lib/types'

import { formatTime, parseDateTime, shiftMinutes } from './events'

/**
 * Export akcí do `.ics` (RFC 5545), čistá logika bez Reactu. Časy z `TeamEvent` jsou lokální
 * (Europe/Prague) bez zóny, proto jdou do `DTSTART`/`DTEND` jako plovoucí čas (bez `Z`) —
 * jinak by je kalendář posunul podle UTC. Jen `DTSTAMP` je opravdu v UTC.
 */

const PRODID = '-//Pina//Pina 2.0//CS'
const DEFAULT_DURATION_MIN = 90
/** RFC 5545 doporučuje skládat řádky na 75 oktetů, jinak je Outlook odmítá. */
const FIRST_LINE_LIMIT = 75
/** Pokračování nese navíc jednu mezeru, proto o oktet méně. */
const CONTINUATION_LIMIT = FIRST_LINE_LIMIT - 1

function pad(part: number): string {
	return String(part).padStart(2, '0')
}

/** „2026-09-15 19:00:00" → `20260915T190000` — plovoucí čas, bez posunu do UTC. */
function formatFloating(value: string): string {
	const date = parseDateTime(value)

	return `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}T${pad(date.getHours())}${pad(
		date.getMinutes(),
	)}${pad(date.getSeconds())}`
}

/** `DTSTAMP` je jediná položka v UTC — kdy byl soubor vyrobený, ne kdy je akce. */
function formatUtc(date: Date): string {
	return `${date.getUTCFullYear()}${pad(date.getUTCMonth() + 1)}${pad(date.getUTCDate())}T${pad(
		date.getUTCHours(),
	)}${pad(date.getUTCMinutes())}${pad(date.getUTCSeconds())}Z`
}

/** Escapování textových hodnot podle RFC 5545 — pořadí je důležité, zpětné lomítko první. */
function escapeText(value: string): string {
	return value.replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\n/g, '\\n')
}

/**
 * Zalomení řádku na 75 oktetů (folding). Počítá se v bajtech UTF-8, ne ve znacích —
 * jinak by se u českých písmen rozhodovalo špatně — a jde po code pointech, aby se
 * nerozsekl jeden znak napůl.
 */
function foldLine(line: string): string {
	const encoder = new TextEncoder()
	const chars = Array.from(line)
	const rows: string[] = []
	let current = ''
	let currentBytes = 0
	let limit = FIRST_LINE_LIMIT

	for (const char of chars) {
		const charBytes = encoder.encode(char).length

		if (currentBytes + charBytes > limit) {
			rows.push(current)
			current = ''
			currentBytes = 0
			limit = CONTINUATION_LIMIT
		}

		current += char
		currentBytes += charBytes
	}

	rows.push(current)

	return rows.map((row, index) => (index === 0 ? row : ` ${row}`)).join('\r\n')
}

function contentLine(name: string, value: string): string {
	return foldLine(`${name}:${value}`)
}

function formatLocation(location: EventLocation): string {
	const address = location.address?.trim()

	return address === undefined || address === '' ? location.name : `${location.name}, ${address}`
}

function buildDescription(event: TeamEvent): string {
	const parts: string[] = []

	if (event.opponent !== null) parts.push(`Soupeř: ${event.opponent}`)
	if (event.note !== null) parts.push(`Poznámka: ${event.note}`)
	if (event.meetAt !== null) parts.push(`Sraz: ${formatTime(event.meetAt)}`)

	return parts.join('\n')
}

function buildEventLines(event: TeamEvent, teamName: string, now: Date): string[] {
	const endsAt = event.endsAt ?? shiftMinutes(event.startsAt, DEFAULT_DURATION_MIN)
	const description = buildDescription(event)
	const lines = [
		'BEGIN:VEVENT',
		contentLine('UID', `pina-event-${event.id}@pinaprosek.eu`),
		contentLine('DTSTAMP', formatUtc(now)),
		contentLine('DTSTART', formatFloating(event.startsAt)),
		contentLine('DTEND', formatFloating(endsAt)),
		contentLine('SUMMARY', escapeText(`${teamName} – ${event.title}`)),
	]

	if (event.location !== null) lines.push(contentLine('LOCATION', escapeText(formatLocation(event.location))))
	if (description !== '') lines.push(contentLine('DESCRIPTION', escapeText(description)))

	lines.push(contentLine('STATUS', event.status === 'cancelled' ? 'CANCELLED' : 'CONFIRMED'))
	lines.push('END:VEVENT')

	return lines
}

function buildCalendar(events: TeamEvent[], teamName: string, calendarName: string, now: Date): string {
	const lines = [
		'BEGIN:VCALENDAR',
		'VERSION:2.0',
		`PRODID:${PRODID}`,
		'CALSCALE:GREGORIAN',
		contentLine('X-WR-CALNAME', escapeText(calendarName)),
	]

	for (const event of events) lines.push(...buildEventLines(event, teamName, now))

	lines.push('END:VCALENDAR')

	// RFC 5545 chce \r\n na konci každého řádku, jinak to Outlook odmítne.
	return lines.join('\r\n') + '\r\n'
}

/**
 * Jedna akce jako samostatný `.ics`. `now` je nepovinné kvůli testům — bez
 * něj se použije aktuální čas.
 */
export function eventToIcs(event: TeamEvent, options: { teamName: string }, now: Date = new Date()): string {
	return buildCalendar([event], options.teamName, options.teamName, now)
}

/**
 * Víc akcí v jednom souboru — `calendarName` jde do `X-WR-CALNAME`, což
 * Outlook i Apple Kalendář použijí jako název naimportovaného kalendáře.
 */
export function eventsToIcs(
	events: TeamEvent[],
	options: { teamName: string; calendarName: string },
	now: Date = new Date(),
): string {
	return buildCalendar(events, options.teamName, options.calendarName, now)
}

/** „Prosek – muži" → „prosek-muzi.ics" — bez diakritiky a mezer, ať to projde jako název souboru všude. */
export function icsFileName(name: string): string {
	const slug = name
		.normalize('NFD')
		.replace(/[\u0300-\u036f]/g, '')
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, '-')
		.replace(/^-+|-+$/g, '')

	return `${slug === '' ? 'kalendar' : slug}.ics`
}
