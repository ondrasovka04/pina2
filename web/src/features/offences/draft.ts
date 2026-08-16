import type { BatchInput, EventParticipant, EventType, MemberBalance, OffenceType } from '@/lib/types'

// Rozepsaná dávka jako plochá mapa (ne zanoření) — jeden klíč = jedna změna v Reactu
export type Draft = Readonly<Record<string, number>>

export const emptyDraft: Draft = {}

export function draftKey(membershipId: number, offenceTypeId: number): string {
	return `${membershipId}:${offenceTypeId}`
}

export function draftCount(draft: Draft, membershipId: number, offenceTypeId: number): number {
	return draft[draftKey(membershipId, offenceTypeId)] ?? 0
}

// Klesne-li počet na nulu, klíč vymizí — řádky s nulou nejsou v souhrnu
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

/** Pravidlo pro konkrétní druh akce má přednost před „u každé akce" — sazby za trénink a zápas se liší zásadně, špatná volba by strhla jinou částku. */
function ruleFor(types: readonly OffenceType[], rule: string, eventType: EventType): OffenceType | undefined {
	const usable = types.filter((type) => type.autoRule === rule && type.archivedAt === null)

	return usable.find((type) => type.autoEventType === eventType) ?? usable.find((type) => type.autoEventType === 'any')
}

/** Předvyplní návrh z docházky — omluvenou absenci pozná podle `rsvp === 'no'`, zraněné a nezjištěné vynechává; pozdní příchod nelze odvodit. */
export function suggestFromAttendance(
	participants: readonly EventParticipant[],
	types: readonly OffenceType[],
	eventType: EventType,
): Draft {
	const excused = ruleFor(types, 'excused_absence', eventType)
	const unexcused = ruleFor(types, 'unexcused_absence', eventType)

	if (excused === undefined && unexcused === undefined) return emptyDraft

	const draft: Record<string, number> = {}

	for (const participant of participants) {
		if (participant.attendance !== 'absent') continue

		// Kdo na soupisce není, tomu se nic nenavrhuje — nemá kde chybět.
		if (!participant.onRoster) continue

		// Chybí-li odpovídající položka sazebníku, nenavrhne se nic — strhnout špatnou absenci jen proto,
		// že položka chybí, by bylo horší.
		const type = participant.rsvp === 'no' ? excused : unexcused

		if (type === undefined) continue

		draft[draftKey(participant.membershipId, type.id)] = 1
	}

	return draft
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
	balanceCzk: number
	totalCzk: number
	items: DraftItem[]
}

export interface DraftSummary {
	members: DraftMember[]
	recordCount: number
	totalCzk: number
}

function byName(a: { name: string }, b: { name: string }): number {
	return a.name.localeCompare(b.name, 'cs')
}

// Souhrn k odsouhlasení — server stejně kontroluje a při změně sazebníku odmítne
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

		// Hráč nebo prohřešek zmizel — přeskok, ne pád s rozepsanou dávkou
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

// expectedAmountCzk chrání před tichým snížením, když se sazebník změní
export function toBatchInput(
	summary: DraftSummary,
	options: { clientUuid: string; occurredOn: string; title: string | null; eventId?: number | null },
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
		eventId: options.eventId ?? null,
		items,
	}
}
