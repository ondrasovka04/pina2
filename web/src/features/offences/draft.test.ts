import { describe, expect, it } from 'vitest'

import type { MemberBalance, OffenceType } from '@/lib/types'

import { changeCount, draftCount, emptyDraft, isDraftEmpty, summarizeDraft, toBatchInput } from './draft'

function member(id: number, name: string, balanceCzk = 0): MemberBalance {
	return {
		membershipId: id,
		userId: id,
		name,
		jerseyNumber: null,
		status: 'active',
		onRoster: true,
		recordCount: 0,
		balanceCzk,
	}
}

function type(id: number, name: string, amountCzk: number): OffenceType {
	return { id, seasonId: 1, name, amountCzk, sortOrder: id, category: null, autoRule: 'none', archivedAt: null }
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
