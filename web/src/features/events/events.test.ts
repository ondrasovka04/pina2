import { describe, expect, it } from 'vitest'

import type { EventParticipant, TeamEvent } from '@/lib/types'

import {
	buildRrule,
	canAnswer,
	describeRrule,
	deadlineState,
	driverSummary,
	formatDeadline,
	formatEventTime,
	formatRatio,
	formatTime,
	groupByMonth,
	linkableMatches,
	navigationUrl,
	nextEvent,
	nominationList,
	parseRrule,
	rsvpSummary,
	shiftMinutes,
	sortParticipants,
	todayOrLater,
	weekdays,
} from './events'

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
		travelLinkEvent: null,
		rsvpDeadlineAt: null,
		rsvpDeadlineCustom: null,
		status: 'planned',
		nominationPublished: false,
		isHome: null,
		overridden: false,
		started: false,
		rosterCount: 10,
		counts: { yes: 0, no: 0, unknown: 0 },
		me: {
			membershipId: 1,
			rsvp: 'unknown',
			rsvpNote: null,
			rsvpAt: null,
			rsvpLate: false,
			nomination: 'none',
			nominationPosition: null,
			transport: 'none',
			carSeats: null,
			attendance: null,
		},
		...overrides,
	}
}

function participant(overrides: Partial<EventParticipant> = {}): EventParticipant {
	return {
		membershipId: 1,
		userId: 1,
		name: 'Adam Novák',
		avatarUrl: null,
		jerseyNumber: null,
		onRoster: true,
		nomination: 'none',
		nominationPosition: null,
		rsvp: 'unknown',
		rsvpNote: null,
		rsvpAt: null,
		rsvpLate: false,
		transport: 'none',
		carSeats: null,
		attendance: null,
		corrected: false,
		...overrides,
	}
}

describe('deadlineState', () => {
	const now = new Date('2026-09-15T06:00:00')

	it('rozliší akci bez termínu a vzdálený termín', () => {
		expect(deadlineState(event({ rsvpDeadlineAt: null }), now)).toBe('none')
		expect(deadlineState(event({ rsvpDeadlineAt: '2026-09-15 18:00:01' }), now)).toBe('open')
	})

	it('přepne přesně na hranici dvanácti hodin a po termínu', () => {
		expect(deadlineState(event({ rsvpDeadlineAt: '2026-09-15 18:00:00' }), now)).toBe('soon')
		expect(deadlineState(event({ rsvpDeadlineAt: '2026-09-15 17:59:59' }), now)).toBe('soon')
		expect(deadlineState(event({ rsvpDeadlineAt: '2026-09-15 05:59:59' }), now)).toBe('passed')
	})

	it('formátuje konkrétní den a čas', () => {
		expect(formatDeadline('2026-09-15 18:00:00', now)).toBe('do 18:00')
		expect(formatDeadline('2026-09-16 07:00:00', now)).toBe('do zítřejších 07:00')
		expect(formatDeadline('2026-09-18 18:00:00', now)).toBe('do pátku 18:00')
	})

	// Termín může být podle nastavení až měsíc dopředu; samotné „do pátku" by pak
	// ukazovalo na nejbližší pátek, ne na ten správný.
	it('u vzdáleného termínu napíše datum, ne název dne', () => {
		expect(formatDeadline('2026-10-16 18:00:00', now)).toBe('do 16. 10. 18:00')
	})
})

describe('groupByMonth', () => {
	it('seskupí akce po měsících v pořadí, jak přišly', () => {
		const events = [
			event({ id: 1, startsAt: '2026-09-01 19:00:00' }),
			event({ id: 2, startsAt: '2026-10-01 19:00:00' }),
		]

		const months = groupByMonth(events)

		expect(months.map((month) => month.key)).toEqual(['2026-09', '2026-10'])
	})

	it('na prázdný vstup vrátí prázdné pole', () => {
		expect(groupByMonth([])).toEqual([])
	})

	it('dvě akce v témže měsíci spadnou do jedné skupiny', () => {
		const events = [
			event({ id: 1, startsAt: '2026-09-01 19:00:00' }),
			event({ id: 2, startsAt: '2026-09-15 19:00:00' }),
		]

		const months = groupByMonth(events)

		expect(months).toHaveLength(1)
		expect(months[0]?.events.map((item) => item.id)).toEqual([1, 2])
	})

	it('návrat do stejného měsíce po jiném měsíci vyrobí novou skupinu', () => {
		const events = [
			event({ id: 1, startsAt: '2026-09-01 19:00:00' }),
			event({ id: 2, startsAt: '2026-10-01 19:00:00' }),
			event({ id: 3, startsAt: '2026-09-20 19:00:00' }),
		]

		const months = groupByMonth(events)

		expect(months.map((month) => month.key)).toEqual(['2026-09', '2026-10', '2026-09'])
	})
})

describe('canAnswer', () => {
	it('je false pro už započatou akci', () => {
		expect(canAnswer(event({ started: true }))).toBe(false)
	})

	it('je false pro zrušenou akci', () => {
		expect(canAnswer(event({ status: 'cancelled' }))).toBe(false)
	})

	it('je false pro toho, kdo v družstvu není', () => {
		expect(canAnswer(event({ me: null }))).toBe(false)
	})

	it('je true jinak', () => {
		expect(canAnswer(event())).toBe(true)
	})
})

describe('nextEvent', () => {
	it('vrátí první nezapočatou plánovanou akci', () => {
		const events = [
			event({ id: 1, started: true }),
			event({ id: 2, status: 'cancelled' }),
			event({ id: 3 }),
			event({ id: 4 }),
		]

		expect(nextEvent(events)?.id).toBe(3)
	})

	it('vrátí null, když žádná taková akce není', () => {
		const events = [event({ started: true }), event({ status: 'cancelled' })]

		expect(nextEvent(events)).toBeNull()
	})
})

describe('linkableMatches', () => {
	it('nabídne jen zápasy, ne tréninky ani zrušené a jinak napojené akce', () => {
		const events = [
			event({ id: 1, type: 'match' }),
			event({ id: 2, type: 'training' }),
			event({ id: 3, type: 'match', status: 'cancelled' }),
			event({ id: 4, type: 'match', travelLinkEvent: { id: 1, title: 'Zápas 1' } }),
		]

		expect(linkableMatches(events, null, '2026-09-15 19:00:00').map((item) => item.id)).toEqual([1])
	})

	it('vyloučí zadanou akci ze seznamu — nejde napojit sama na sebe', () => {
		const events = [event({ id: 1, type: 'match' }), event({ id: 2, type: 'match' })]

		expect(linkableMatches(events, 1, '2026-09-15 19:00:00').map((item) => item.id)).toEqual([2])
	})

	it('řadí podle blízkosti k datu upravované akce, ne chronologicky', () => {
		const events = [
			event({ id: 1, type: 'match', startsAt: '2026-09-01 19:00:00' }),
			event({ id: 2, type: 'match', startsAt: '2026-10-05 19:00:00' }),
			event({ id: 3, type: 'match', startsAt: '2026-10-04 10:00:00' }),
		]

		// Upravovaná akce je 4. 10. odpoledne — nejbližší kandidát je zápas ráno téhož dne, ne chronologicky první.
		expect(linkableMatches(events, null, '2026-10-04 16:00:00').map((item) => item.id)).toEqual([3, 2, 1])
	})
})

describe('rsvpSummary', () => {
	it('vynechá nulové části', () => {
		expect(rsvpSummary({ yes: 12, no: 0, unknown: 7 })).toBe('12 přijde · 7 neví')
	})

	it('hlásí, že zatím nikdo neodpověděl, když jsou samé nuly', () => {
		expect(rsvpSummary({ yes: 0, no: 0, unknown: 0 })).toBe('Zatím nikdo neodpověděl')
	})
})

describe('driverSummary', () => {
	it('vrátí null bez řidičů', () => {
		expect(driverSummary([participant({ transport: 'none' })])).toBeNull()
	})

	it('počítá jen řidiče, kteří odpověděli ano', () => {
		const participants = [
			participant({ membershipId: 1, transport: 'driver', rsvp: 'yes', carSeats: 3 }),
			participant({ membershipId: 2, transport: 'driver', rsvp: 'unknown', carSeats: 2 }),
		]

		expect(driverSummary(participants)).toBe('1 řidič, 3 volných míst')
	})

	it('používá množné číslo pro víc řidičů a sečte volná místa', () => {
		const participants = [
			participant({ membershipId: 1, transport: 'driver', rsvp: 'yes', carSeats: 3 }),
			participant({ membershipId: 2, transport: 'driver', rsvp: 'yes', carSeats: 2 }),
		]

		expect(driverSummary(participants)).toBe('2 řidiči, 5 volných míst')
	})

	it('vynechá počet míst, když jsou auta plná', () => {
		const participants = [participant({ transport: 'driver', rsvp: 'yes', carSeats: 0 })]

		expect(driverSummary(participants)).toBe('1 řidič')
	})
})

describe('formatRatio', () => {
	it('vrátí pomlčku pro null', () => {
		expect(formatRatio(null)).toBe('—')
	})

	it('zaokrouhlí na procenta', () => {
		expect(formatRatio(0.666)).toBe('67 %')
	})

	it('zvládne nulu', () => {
		expect(formatRatio(0)).toBe('0 %')
	})

	it('zvládne jedničku', () => {
		expect(formatRatio(1)).toBe('100 %')
	})
})

describe('buildRrule', () => {
	it('seřadí dny vždy od pondělí bez ohledu na pořadí na vstupu', () => {
		expect(buildRrule(['FR', 'MO', 'WE'])).toBe('FREQ=WEEKLY;BYDAY=MO,WE,FR')
	})

	it('přidá INTERVAL jen když je větší než 1', () => {
		expect(buildRrule(['MO'], 1)).toBe('FREQ=WEEKLY;BYDAY=MO')
		expect(buildRrule(['MO'], 2)).toBe('FREQ=WEEKLY;INTERVAL=2;BYDAY=MO')
	})

	it('u prázdného výběru vrátí prázdný řetězec', () => {
		expect(buildRrule([])).toBe('')
	})
})

describe('parseRrule', () => {
	it('přečte dny i INTERVAL zpátky', () => {
		expect(parseRrule('FREQ=WEEKLY;INTERVAL=2;BYDAY=TU,TH')).toEqual({ days: ['TU', 'TH'], interval: 2 })
	})

	it('toleruje malá písmena a mezery', () => {
		expect(parseRrule(' freq = weekly ; byday=tu,th ')).toEqual({ days: ['TU', 'TH'], interval: 1 })
	})

	it('neznámý vstup vrátí prázdné dny a interval 1', () => {
		expect(parseRrule('nesmysl')).toEqual({ days: [], interval: 1 })
	})

	it('kolečko buildRrule -> parseRrule vrátí původní hodnoty', () => {
		const days: (typeof weekdays)[number][] = ['TH', 'MO']
		const interval = 3

		expect(parseRrule(buildRrule(days, interval))).toEqual({ days: ['MO', 'TH'], interval })
	})
})

describe('describeRrule', () => {
	it('popíše jeden den', () => {
		expect(describeRrule('FREQ=WEEKLY;BYDAY=MO', '19:00')).toBe('každé pondělí v 19:00')
	})

	it('popíše dva dny spojkou a', () => {
		expect(describeRrule('FREQ=WEEKLY;BYDAY=TU,TH', '19:00')).toBe('každé úterý a čtvrtek v 19:00')
	})

	it('popíše tři dny čárkami a spojkou a před posledním', () => {
		expect(describeRrule('FREQ=WEEKLY;BYDAY=MO,WE,FR', '19:00')).toBe('každé pondělí, středu a pátek v 19:00')
	})

	it('popíše interval větší než 1', () => {
		expect(describeRrule('FREQ=WEEKLY;INTERVAL=2;BYDAY=MO', '19:00')).toBe('každý 2. týden v pondělí v 19:00')
	})

	it('u prázdného výběru vyzve k volbě dne', () => {
		expect(describeRrule('', '19:00')).toBe('Vyberte aspoň jeden den')
	})
})

describe('navigationUrl', () => {
	it('upřednostní souřadnice před adresou', () => {
		const url = navigationUrl({ address: 'Nějaká hala', lat: 50.1, lng: 14.5 })

		expect(url).toBe('https://www.google.com/maps/dir/?api=1&destination=50.1,14.5')
	})

	it('adresu URL-enkóduje', () => {
		const url = navigationUrl({ address: 'Sportovní hala, Praha', lat: null, lng: null })

		expect(url).toBe(
			`https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent('Sportovní hala, Praha')}`,
		)
	})

	it('bez souřadnic i adresy vrátí null', () => {
		expect(navigationUrl({ address: null, lat: null, lng: null })).toBeNull()
	})

	it('prázdnou adresu bere jako žádnou', () => {
		expect(navigationUrl({ address: '   ', lat: null, lng: null })).toBeNull()
	})
})

describe('sortParticipants', () => {
	it('dá soupisku nahoru a zbytek seřadí česky', () => {
		const participants = [
			participant({ membershipId: 1, name: 'Zeman', onRoster: true }),
			participant({ membershipId: 2, name: 'Čapek', onRoster: false }),
			participant({ membershipId: 3, name: 'Cyril', onRoster: true }),
		]

		const sorted = sortParticipants(participants)

		expect(sorted.map((person) => person.name)).toEqual(['Cyril', 'Zeman', 'Čapek'])
	})

	it('řadí Č za C, ne až za Z', () => {
		const participants = [
			participant({ membershipId: 1, name: 'Žák' }),
			participant({ membershipId: 2, name: 'Čapek' }),
			participant({ membershipId: 3, name: 'Cyril' }),
		]

		expect(sortParticipants(participants).map((person) => person.name)).toEqual(['Cyril', 'Čapek', 'Žák'])
	})

	it('nemění původní pole', () => {
		const participants = [
			participant({ membershipId: 1, name: 'Zeman' }),
			participant({ membershipId: 2, name: 'Adam' }),
		]
		const original = [...participants]

		sortParticipants(participants)

		expect(participants).toEqual(original)
	})
})

describe('nominationList', () => {
	it('vypíše jen nominované, s postem, je-li nastavený, v pořadí soupisky', () => {
		const participants = [
			participant({ membershipId: 1, name: 'Kopáč', nomination: 'nominated', nominationPosition: 'S' }),
			participant({ membershipId: 2, name: 'Ivan', nomination: 'nominated', nominationPosition: null }),
			participant({ membershipId: 3, name: 'Náhradník', nomination: 'substitute', nominationPosition: 'U' }),
			participant({ membershipId: 4, name: 'Doma', nomination: 'none' }),
		]

		// Stejné pořadí jako v samotném seznamu (sortParticipants) — abecedně: Ivan před Kopáčem.
		expect(nominationList(participants)).toBe('Ivan\nS - Kopáč')
	})

	it('prázdná nominace dá prázdný řetězec', () => {
		expect(nominationList([])).toBe('')
	})
})

describe('formatEventTime', () => {
	it('obsahuje hodinu a minutu', () => {
		expect(formatEventTime('2026-09-15 19:05:00')).toMatch(/\d{1,2}:\d{2}/)
	})

	it('na nesmyslném vstupu vrátí vstup zpátky', () => {
		expect(formatEventTime('nesmysl')).toBe('nesmysl')
	})
})

describe('formatTime', () => {
	it('obsahuje hodinu a minutu', () => {
		expect(formatTime('2026-09-15 19:05:00')).toMatch(/\d{1,2}:\d{2}/)
	})

	it('na nesmyslném vstupu vrátí vstup zpátky', () => {
		expect(formatTime('nesmysl')).toBe('nesmysl')
	})
})

describe('shiftMinutes', () => {
	it('přičte délku akce a vyrobí čas konce', () => {
		expect(shiftMinutes('2026-09-15 19:00', 90)).toBe('2026-09-15 20:30')
	})

	it('záporný posun dá čas srazu', () => {
		expect(shiftMinutes('2026-09-15 19:00', -15)).toBe('2026-09-15 18:45')
	})

	it('přeteče přes půlnoc do dalšího dne', () => {
		expect(shiftMinutes('2026-09-15 23:30', 60)).toBe('2026-09-16 00:30')
	})

	it('rozumí i tvaru s „T" z datetime-local', () => {
		expect(shiftMinutes('2026-09-15T19:00', 30)).toBe('2026-09-15 19:30')
	})

	it('na nesmyslném vstupu vrátí vstup zpátky', () => {
		expect(shiftMinutes('nesmysl', 30)).toBe('nesmysl')
	})
})

describe('todayOrLater', () => {
	it('u rozjeté sezóny nabídne dnešek', () => {
		expect(todayOrLater('2026-09-01', new Date(2027, 0, 12))).toBe('2027-01-12')
	})

	it('u budoucí sezóny nabídne její začátek', () => {
		expect(todayOrLater('2026-09-01', new Date(2026, 7, 16))).toBe('2026-09-01')
	})

	it('doplní nuly u jednociferného měsíce a dne', () => {
		expect(todayOrLater('2020-01-01', new Date(2027, 2, 5))).toBe('2027-03-05')
	})
})
