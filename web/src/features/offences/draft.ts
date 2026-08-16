import type { BatchInput, MemberBalance, OffenceType } from '@/lib/types'

/**
 * Rozepsaná dávka prohřešků, než ji pínař odešle.
 *
 * Držíme ji jako plochou mapu `hráč:prohřešek → počet`, ne jako zanořenou
 * strukturu — přidání dalšího zápisu je pak jedna změna klíče a React nemusí
 * porovnávat vnořená pole. Logika je schválně mimo komponentu: souhrn s částkami
 * je to jediné, co pínař před odesláním čte, takže se musí dát otestovat
 * bez vykreslování.
 */
export type Draft = Readonly<Record<string, number>>

export const emptyDraft: Draft = {}

export function draftKey(membershipId: number, offenceTypeId: number): string {
	return `${membershipId}:${offenceTypeId}`
}

export function draftCount(draft: Draft, membershipId: number, offenceTypeId: number): number {
	return draft[draftKey(membershipId, offenceTypeId)] ?? 0
}

/**
 * Přičte (nebo ubere) zápisy. Klesne-li počet na nulu, klíč se z dávky vyhodí —
 * jinak by v souhrnu zůstávaly řádky s nulou.
 */
export function changeCount(draft: Draft, membershipId: number, offenceTypeId: number, delta: number): Draft {
	const key = draftKey(membershipId, offenceTypeId)
	const next = (draft[key] ?? 0) + delta

	if (next <= 0) {
		const { [key]: _removed, ...rest } = draft

		return rest
	}

	// Strop 99 drží klient i server; víc než dvojciferný počet téhož prohřešku
	// je skoro jistě překlep.
	return { ...draft, [key]: Math.min(next, 99) }
}

export function isDraftEmpty(draft: Draft): boolean {
	return Object.keys(draft).length === 0
}

export interface DraftItem {
	offenceTypeId: number
	name: string
	amountCzk: number
	count: number
	totalCzk: number
}

export interface DraftMember {
	membershipId: number
	name: string
	jerseyNumber: number | null
	/** Zůstatek hráče před touhle dávkou. */
	balanceCzk: number
	totalCzk: number
	items: DraftItem[]
}

export interface DraftSummary {
	members: DraftMember[]
	recordCount: number
	totalCzk: number
}

/** Řazení podle jména s českou abecedou — jinak by „Šimek" spadl až za „Zeman". */
function byName(a: { name: string }, b: { name: string }): number {
	return a.name.localeCompare(b.name, 'cs')
}

/**
 * Souhrn k odsouhlasení. Skládá se z toho, co má klient právě na obrazovce —
 * server si stejně pořádí vlastní kontrolu a při změně sazebníku zápis odmítne.
 */
export function summarizeDraft(
	draft: Draft,
	members: readonly MemberBalance[],
	types: readonly OffenceType[],
): DraftSummary {
	const memberById = new Map(members.map((member) => [member.membershipId, member]))
	const typeById = new Map(types.map((type) => [type.id, type]))
	const byMember = new Map<number, DraftMember>()

	let recordCount = 0
	let totalCzk = 0

	for (const [key, count] of Object.entries(draft)) {
		const [rawMember, rawType] = key.split(':')
		const membershipId = Number(rawMember)
		const offenceTypeId = Number(rawType)

		const member = memberById.get(membershipId)
		const type = typeById.get(offenceTypeId)

		// Hráč nebo prohřešek mezitím zmizel ze sazebníku či soupisky —
		// tichý přeskok je lepší než pád obrazovky s rozepsanou dávkou.
		if (member === undefined || type === undefined) continue

		const itemTotal = type.amountCzk * count

		const entry = byMember.get(membershipId) ?? {
			membershipId,
			name: member.name,
			jerseyNumber: member.jerseyNumber,
			balanceCzk: member.balanceCzk,
			totalCzk: 0,
			items: [],
		}

		entry.totalCzk += itemTotal
		entry.items.push({
			offenceTypeId,
			name: type.name,
			amountCzk: type.amountCzk,
			count,
			totalCzk: itemTotal,
		})

		byMember.set(membershipId, entry)
		recordCount += count
		totalCzk += itemTotal
	}

	const sorted = Array.from(byMember.values())
		.toSorted(byName)
		.map((member) => ({ ...member, items: member.items.toSorted(byName) }))

	return { members: sorted, recordCount, totalCzk }
}

/**
 * Tělo požadavku. `expectedAmountCzk` posílá cenu, kterou pínař viděl v souhrnu:
 * když se mezitím změnil sazebník, server zápis odmítne (409) místo aby potichu
 * strhl jinou částku.
 */
export function toBatchInput(
	summary: DraftSummary,
	options: { clientUuid: string; occurredOn: string; title: string | null },
): BatchInput {
	const items = summary.members.flatMap((member) =>
		member.items.map((item) => ({
			membershipId: member.membershipId,
			offenceTypeId: item.offenceTypeId,
			count: item.count,
			expectedAmountCzk: item.amountCzk,
		})),
	)

	return {
		clientUuid: options.clientUuid,
		occurredOn: options.occurredOn,
		title: options.title,
		items,
	}
}
