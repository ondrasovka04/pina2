import { describe, expect, it } from 'vitest'

import type { Attendance, EventParticipant, EventType, MemberBalance, OffenceType, Rsvp } from '@/lib/types'

import {
	changeCount,
	draftCount,
	draftKey,
	emptyDraft,
	isDraftEmpty,
	suggestFromAttendance as suggestFromAttendanceForEvent,
	summarizeDraft,
	toBatchInput,
} from './draft'

function member(id: number, name: string, balanceCzk = 0): MemberBalance {
	return {
		membershipId: id,
		userId: id,
		name,
		avatarUrl: null,
		jerseyNumber: null,
		status: 'active',
		onRoster: true,
		recordCount: 0,
		offencesCzk: 0,
		bonusesCzk: 0,
		paidCzk: 0,
		travelCzk: 0,
		balanceCzk,
		halves: null,
	}
}

function type(id: number, name: string, amountCzk: number): OffenceType {
	return {
		id,
		seasonId: 1,
		name,
		amountCzk,
		sortOrder: id,
		category: null,
		autoRule: 'none',
		autoEventType: 'any',
		archivedAt: null,
	}
}

const members = [member(1, 'Adam Novák', 200), member(2, 'Bára Svobodová', -50)]
const types = [type(10, 'Pozdní příchod', 20), type(11, 'MVP zápasu', -100)]

describe('changeCount', () => {
	it('přičítá zápisy témuž hráči', () => {
		const draft = changeCount(changeCount(emptyDraft, 1, 10, 1), 1, 10, 1)

		expect(draftCount(draft, 1, 10)).toBe(2)
	})

	it('vyhodí položku, když počet klesne na nulu', () => {
		const draft = changeCount(changeCount(emptyDraft, 1, 10, 1), 1, 10, -1)

		expect(isDraftEmpty(draft)).toBe(true)
	})

	it('nespadne pod nulu ani při opakovaném ubírání', () => {
		const draft = changeCount(emptyDraft, 1, 10, -5)

		expect(draftCount(draft, 1, 10)).toBe(0)
	})

	it('drží strop 99, aby překlep nezaložil stovky řádků', () => {
		const draft = changeCount(emptyDraft, 1, 10, 500)

		expect(draftCount(draft, 1, 10)).toBe(99)
	})

	it('nemění původní dávku', () => {
		const first = changeCount(emptyDraft, 1, 10, 1)
		changeCount(first, 1, 10, 1)

		expect(draftCount(first, 1, 10)).toBe(1)
	})
})

describe('summarizeDraft', () => {
	it('sečte částky po hráčích a celkem', () => {
		let draft = changeCount(emptyDraft, 1, 10, 3)
		draft = changeCount(draft, 2, 10, 1)

		const summary = summarizeDraft(draft, members, types)

		expect(summary.recordCount).toBe(4)
		expect(summary.totalCzk).toBe(80)
		expect(summary.members.map((entry) => entry.totalCzk)).toEqual([60, 20])
	})

	it('bonus dávku zlevňuje, protože záporná částka není pokuta', () => {
		let draft = changeCount(emptyDraft, 1, 10, 1)
		draft = changeCount(draft, 1, 11, 1)

		const summary = summarizeDraft(draft, members, types)

		expect(summary.totalCzk).toBe(-80)
	})

	it('přeskočí prohřešek, který mezitím zmizel ze sazebníku', () => {
		const draft = changeCount(emptyDraft, 1, 999, 1)

		expect(summarizeDraft(draft, members, types).members).toHaveLength(0)
	})

	it('řadí hráče podle českého jména', () => {
		let draft = changeCount(emptyDraft, 2, 10, 1)
		draft = changeCount(draft, 1, 10, 1)

		expect(summarizeDraft(draft, members, types).members.map((entry) => entry.name)).toEqual([
			'Adam Novák',
			'Bára Svobodová',
		])
	})

	it('nese zůstatek hráče před dávkou, aby šlo ukázat, kam se dostane', () => {
		const draft = changeCount(emptyDraft, 1, 10, 1)

		expect(summarizeDraft(draft, members, types).members[0]?.balanceCzk).toBe(200)
	})
})

describe('toBatchInput', () => {
	it('posílá cenu, kterou pínař viděl v souhrnu', () => {
		const draft = changeCount(emptyDraft, 1, 10, 2)
		const input = toBatchInput(summarizeDraft(draft, members, types), {
			clientUuid: '11111111-2222-3333-4444-555555555555',
			occurredOn: '2026-09-01',
			title: 'Trénink',
		})

		expect(input.items).toEqual([{ membershipId: 1, offenceTypeId: 10, count: 2, expectedAmountCzk: 20 }])
	})
})

// --- návrh z docházky --------------------------------------------------------

function participant(id: number, attendance: Attendance | null, rsvp: Rsvp, onRoster = true): EventParticipant {
	return {
		membershipId: id,
		userId: id,
		name: `Hráč ${id}`,
		avatarUrl: null,
		jerseyNumber: null,
		onRoster,
		nomination: 'none',
		rsvp,
		rsvpNote: null,
		rsvpAt: null,
		rsvpLate: false,
		transport: 'none',
		carSeats: null,
		attendance,
		corrected: false,
	}
}

function suggestFromAttendance(
	participants: readonly EventParticipant[],
	offenceTypes: readonly OffenceType[],
	eventType: EventType,
	rsvpDeadlineAt: string | null = '2026-09-15 18:00:00',
) {
	return suggestFromAttendanceForEvent(participants, offenceTypes, { type: eventType, rsvpDeadlineAt })
}

function rule(
	id: number,
	autoRule: string,
	autoEventType = 'any',
	archivedAt: string | null = null,
	amountCzk = 25,
): OffenceType {
	return {
		id,
		seasonId: 1,
		name: `Pravidlo ${id}`,
		amountCzk,
		sortOrder: id,
		category: null,
		autoRule,
		autoEventType,
		archivedAt,
	}
}

const excused = rule(20, 'excused_absence')
const unexcused = rule(21, 'unexcused_absence')

describe('suggestFromAttendance', () => {
	it('omluvenou absenci pozná podle toho, že hráč předem řekl nepřijdu', () => {
		const draft = suggestFromAttendance([participant(1, 'absent', 'no')], [excused, unexcused], 'training')

		expect(draft).toEqual({ [draftKey(1, excused.id)]: 1 })
	})

	it('kdo se vůbec neozval, má neomluvenou', () => {
		const draft = suggestFromAttendance([participant(1, 'absent', 'unknown')], [excused, unexcused], 'training')

		expect(draft).toEqual({ [draftKey(1, unexcused.id)]: 1 })
	})

	it('kdo slíbil účast a nedorazil, má taky neomluvenou', () => {
		const draft = suggestFromAttendance([participant(1, 'absent', 'yes')], [excused, unexcused], 'training')

		expect(draft).toEqual({ [draftKey(1, unexcused.id)]: 1 })
	})

	it('kdo přišel nebo je zraněný, se nenavrhuje', () => {
		const draft = suggestFromAttendance(
			[participant(1, 'present', 'yes'), participant(2, 'injured', 'no'), participant(3, null, 'unknown')],
			[excused, unexcused],
			'training',
		)

		expect(draft).toEqual(emptyDraft)
	})

	it('kdo není na soupisce, se nenavrhuje — nemá kde chybět', () => {
		const draft = suggestFromAttendance([participant(1, 'absent', 'unknown', false)], [excused, unexcused], 'training')

		expect(draft).toEqual(emptyDraft)
	})

	it('bez nastavených pravidel nenavrhne nic', () => {
		const draft = suggestFromAttendance([participant(1, 'absent', 'no')], [rule(30, 'none')], 'training')

		expect(draft).toEqual(emptyDraft)
	})

	it('chybí-li jedno z pravidel, druhý případ se nenahrazuje', () => {
		// Strhnout omluvenému neomluvenou absenci jen proto, že položka chybí,
		// je horší než nenavrhnout nic.
		const draft = suggestFromAttendance(
			[participant(1, 'absent', 'no'), participant(2, 'absent', 'unknown')],
			[unexcused],
			'training',
		)

		expect(draft).toEqual({ [draftKey(2, unexcused.id)]: 1 })
	})

	it('archivované pravidlo se nepoužije', () => {
		const draft = suggestFromAttendance(
			[participant(1, 'absent', 'no')],
			[rule(20, 'excused_absence', 'any', '2026-08-01 10:00:00')],
			'training',
		)

		expect(draft).toEqual(emptyDraft)
	})

	it('pravidlo pro daný druh akce má přednost před obecným', () => {
		// Omluvený trénink stojí u mužů 35 Kč, omluvený zápas 100 Kč — sáhnout
		// vedle znamená strhnout špatnou částku.
		const obecne = rule(20, 'excused_absence', 'any', null, 35)
		const zapas = rule(22, 'excused_absence', 'match', null, 100)

		const naZapase = suggestFromAttendance([participant(1, 'absent', 'no')], [obecne, zapas], 'match')
		const naTreninku = suggestFromAttendance([participant(1, 'absent', 'no')], [obecne, zapas], 'training')

		expect(naZapase).toEqual({ [draftKey(1, zapas.id)]: 1 })
		expect(naTreninku).toEqual({ [draftKey(1, obecne.id)]: 1 })
	})

	it('pravidlo pro jiný druh akce se nepoužije', () => {
		const jenZapas = rule(22, 'excused_absence', 'match')

		expect(suggestFromAttendance([participant(1, 'absent', 'no')], [jenZapas], 'training')).toEqual(emptyDraft)
	})

	it('navrhne po jednom každému, kdo chyběl', () => {
		const draft = suggestFromAttendance(
			[participant(1, 'absent', 'no'), participant(2, 'absent', 'unknown'), participant(3, 'present', 'yes')],
			[excused, unexcused],
			'training',
		)

		expect(Object.values(draft)).toEqual([1, 1])
	})

	it('navrhne pozdní zápis podle snapshotu odpovědi', () => {
		const late = rule(40, 'late_rsvp')
		const person = { ...participant(1, 'present', 'yes'), rsvpLate: true }

		expect(suggestFromAttendance([person], [late], 'training')).toEqual({ [draftKey(1, late.id)]: 1 })
	})

	it('navrhne pozdní zápis i tomu, kdo neodpověděl, ale přišel', () => {
		const late = rule(40, 'late_rsvp')

		expect(suggestFromAttendance([participant(1, 'present', 'unknown')], [late], 'training')).toEqual({
			[draftKey(1, late.id)]: 1,
		})
	})

	it('bez termínu nebo bez položky sazebníku pozdní zápis nenavrhuje', () => {
		const late = rule(40, 'late_rsvp')
		const person = { ...participant(1, 'present', 'yes'), rsvpLate: true }

		expect(suggestFromAttendance([person], [late], 'training', null)).toEqual(emptyDraft)
		expect(suggestFromAttendance([person], [excused], 'training')).toEqual(emptyDraft)
	})

	it('pozdní odhláška navrhne pozdní zápis i omluvenou absenci', () => {
		const late = rule(40, 'late_rsvp')
		const person = { ...participant(1, 'absent', 'no'), rsvpLate: true }

		expect(suggestFromAttendance([person], [late, excused], 'training')).toEqual({
			[draftKey(1, excused.id)]: 1,
			[draftKey(1, late.id)]: 1,
		})
	})

	it('zraněnému pozdní zápis nenavrhuje', () => {
		const late = rule(40, 'late_rsvp')
		const person = { ...participant(1, 'injured', 'yes'), rsvpLate: true }

		expect(suggestFromAttendance([person], [late], 'training')).toEqual(emptyDraft)
	})
})
