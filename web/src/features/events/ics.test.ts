import { describe, expect, it } from 'vitest'

import type { TeamEvent } from '@/lib/types'

import { eventsToIcs, eventToIcs, icsFileName } from './ics'

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
		nominationDeadline: null,
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

const now = new Date('2026-08-16T12:00:00Z')

/** Rozbalí zalomené řádky zpátky do jednoho řetězce na content line — RFC 5545 folding naruby. */
function unfold(ics: string): string[] {
	const lines = ics.split('\r\n')
	const result: string[] = []

	for (const line of lines) {
		if (line.startsWith(' ') && result.length > 0) {
			result[result.length - 1] += line.slice(1)
		} else if (line !== '') {
			result.push(line)
		}
	}

	return result
}

describe('eventToIcs', () => {
	it('vyrobí platnou hlavičku a jeden VEVENT', () => {
		const ics = eventToIcs(event(), { teamName: 'Prosek – muži' }, now)
		const lines = unfold(ics)

		expect(lines[0]).toBe('BEGIN:VCALENDAR')
		expect(lines).toContain('VERSION:2.0')
		expect(lines).toContain('PRODID:-//Pina//Pina 2.0//CS')
		expect(lines).toContain('CALSCALE:GREGORIAN')
		expect(lines).toContain('BEGIN:VEVENT')
		expect(lines).toContain('END:VEVENT')
		expect(lines.at(-1)).toBe('END:VCALENDAR')
	})

	it('má stabilní UID podle id akce — druhé stažení akci aktualizuje, nepřidá', () => {
		const first = eventToIcs(event({ id: 42 }), { teamName: 'Prosek' }, now)
		const second = eventToIcs(event({ id: 42, title: 'Trénink (přesunuto)' }), { teamName: 'Prosek' }, now)

		const uid = 'UID:pina-event-42@pinaprosek.eu'

		expect(unfold(first)).toContain(uid)
		expect(unfold(second)).toContain(uid)
	})

	it('řádky končí na \\r\\n', () => {
		const ics = eventToIcs(event(), { teamName: 'Prosek' }, now)

		expect(ics).toContain('\r\n')
		expect(ics.includes('\n') && !ics.includes('\r\n')).toBe(false)
		// mimo escapovaný \n v textu by se v souboru neměl objevit osamocený LF
		for (const part of ics.split('\r\n')) {
			expect(part.includes('\n')).toBe(false)
		}
	})

	it('DTSTART je plovoucí čas bez Z, DTSTAMP je v UTC se Z', () => {
		const ics = eventToIcs(event({ startsAt: '2026-09-15 19:00:00' }), { teamName: 'Prosek' }, now)
		const lines = unfold(ics)

		expect(lines).toContain('DTSTART:20260915T190000')
		expect(lines.some((line) => line.startsWith('DTSTAMP:') && line.endsWith('Z'))).toBe(true)
		expect(lines.find((line) => line.startsWith('DTSTART'))?.endsWith('Z')).toBe(false)
	})

	it('DTSTAMP použije předaný čas, ne aktuální', () => {
		const ics = eventToIcs(event(), { teamName: 'Prosek' }, new Date('2026-01-01T10:15:30Z'))

		expect(unfold(ics)).toContain('DTSTAMP:20260101T101530Z')
	})

	it('bez endsAt dopočítá konec jako začátek + 90 minut', () => {
		const ics = eventToIcs(event({ startsAt: '2026-09-15 19:00:00', endsAt: null }), { teamName: 'Prosek' }, now)

		expect(unfold(ics)).toContain('DTEND:20260915T203000')
	})

	it('s endsAt použije čas ze serveru beze změny', () => {
		const ics = eventToIcs(
			event({ startsAt: '2026-09-15 19:00:00', endsAt: '2026-09-15 21:00:00' }),
			{ teamName: 'Prosek' },
			now,
		)

		expect(unfold(ics)).toContain('DTEND:20260915T210000')
	})

	it('escapuje čárku a středník v soupeři', () => {
		const ics = eventToIcs(event({ opponent: 'Slavia; Praha, B-tým' }), { teamName: 'Prosek' }, now)
		const description = unfold(ics).find((line) => line.startsWith('DESCRIPTION:'))

		expect(description).toBe('DESCRIPTION:Soupeř: Slavia\\; Praha\\, B-tým')
	})

	it('poznámku a sraz skládá do popisu, chybějící části vynechá', () => {
		const ics = eventToIcs(
			event({ opponent: 'Slavia', note: 'Vezměte dres', meetAt: '2026-09-15 18:30:00' }),
			{ teamName: 'Prosek' },
			now,
		)
		const description = unfold(ics).find((line) => line.startsWith('DESCRIPTION:'))

		expect(description).toContain('Soupeř: Slavia')
		expect(description).toContain('Poznámka: Vezměte dres')
		expect(description).toContain('Sraz:')
	})

	it('bez soupeře, poznámky a srazu DESCRIPTION vynechá úplně', () => {
		const ics = eventToIcs(event(), { teamName: 'Prosek' }, now)

		expect(unfold(ics).some((line) => line.startsWith('DESCRIPTION'))).toBe(false)
	})

	it('LOCATION spojí název místa a adresu', () => {
		const ics = eventToIcs(
			event({
				location: { id: 1, name: 'Hala Prosek', address: 'Prosecká 1, Praha', lat: null, lng: null, note: null },
			}),
			{ teamName: 'Prosek' },
			now,
		)

		expect(unfold(ics)).toContain('LOCATION:Hala Prosek\\, Prosecká 1\\, Praha')
	})

	it('bez místa LOCATION vynechá', () => {
		const ics = eventToIcs(event({ location: null }), { teamName: 'Prosek' }, now)

		expect(unfold(ics).some((line) => line.startsWith('LOCATION'))).toBe(false)
	})

	it('zrušená akce má STATUS:CANCELLED, jinak STATUS:CONFIRMED', () => {
		const cancelled = eventToIcs(event({ status: 'cancelled' }), { teamName: 'Prosek' }, now)
		const planned = eventToIcs(event({ status: 'planned' }), { teamName: 'Prosek' }, now)

		expect(unfold(cancelled)).toContain('STATUS:CANCELLED')
		expect(unfold(planned)).toContain('STATUS:CONFIRMED')
	})

	it('dlouhý český řádek se zalomí na 75 oktetů a po rozbalení dá původní text', () => {
		const longNote =
			'Přijeďte prosím včas vezměte si vlastní láhev na pití a nezapomeňte na chrániče protože soupeř hraje tvrdě a poznámka musí být opravdu dlouhá'
		const ics = eventToIcs(event({ note: longNote }), { teamName: 'Prosek' }, now)

		const rawLines = ics.split('\r\n').filter((line) => line !== '')
		const encoder = new TextEncoder()

		expect(rawLines.length).toBeGreaterThan(1)
		for (const line of rawLines) {
			expect(encoder.encode(line).length).toBeLessThanOrEqual(75)
		}

		const description = unfold(ics).find((line) => line.startsWith('DESCRIPTION:'))

		expect(description).toBe(`DESCRIPTION:Poznámka: ${longNote}`)
	})
})

describe('eventsToIcs', () => {
	it('poskládá víc akcí do jednoho kalendáře s X-WR-CALNAME', () => {
		const events = [event({ id: 1 }), event({ id: 2, title: 'Zápas' })]
		const ics = eventsToIcs(events, { teamName: 'Prosek – muži', calendarName: 'Prosek – muži 2026/2027' }, now)
		const lines = unfold(ics)

		expect(lines).toContain('X-WR-CALNAME:Prosek – muži 2026/2027')
		expect(lines.filter((line) => line === 'BEGIN:VEVENT')).toHaveLength(2)
		expect(lines).toContain('UID:pina-event-1@pinaprosek.eu')
		expect(lines).toContain('UID:pina-event-2@pinaprosek.eu')
	})

	it('prázdný seznam akcí vyrobí platný kalendář bez VEVENT', () => {
		const ics = eventsToIcs([], { teamName: 'Prosek', calendarName: 'Prosek' }, now)
		const lines = unfold(ics)

		expect(lines[0]).toBe('BEGIN:VCALENDAR')
		expect(lines.at(-1)).toBe('END:VCALENDAR')
		expect(lines.some((line) => line.startsWith('BEGIN:VEVENT'))).toBe(false)
	})
})

describe('icsFileName', () => {
	it('odstraní diakritiku a nahradí mezery pomlčkou', () => {
		expect(icsFileName('Prosek – muži')).toBe('prosek-muzi.ics')
	})

	it('nahradí lomítko pomlčkou', () => {
		expect(icsFileName('Přátelák/Turnaj')).toBe('pratelak-turnaj.ics')
	})

	it('slije víc oddělovačů za sebou do jedné pomlčky', () => {
		expect(icsFileName('Tým   B,  ženy')).toBe('tym-b-zeny.ics')
	})

	it('ořízne pomlčky na začátku a konci', () => {
		expect(icsFileName('  Junioři!  ')).toBe('juniori.ics')
	})

	it('na prázdný název vrátí náhradní jméno souboru', () => {
		expect(icsFileName('!!!')).toBe('kalendar.ics')
	})
})
