import type { AutoEventType, AutoRule, OffenceType } from '@/lib/types'
import { toAutoEventType, toAutoRule } from '@/lib/types'

export interface AutoRuleConflict {
	/** Název položky, která si s nastavovanou konkuruje. */
	name: string
	/** Konkurenci jde rozsoudit — jedna z položek platí pro konkrétnější druh akce a vyhraje. */
	soft: boolean
	/** Ta druhá platí „u každé akce". Rozhoduje jen o znění hlášky. */
	otherIsAny: boolean
}

/**
 * Dvě položky sazebníku se stejným pravidlem si konkurují.
 *
 * Konkrétní druh akce má přednost před „u každé akce", takže takovou dvojici
 * `suggestFromAttendance` rozsoudí a stačí na ni upozornit. Dvě položky pro tentýž
 * druh akce rozsoudit nejde a předvyplní se jen jedna — a protože se za trénink
 * a zápas platí jinak, je to rozdíl o stovky korun.
 *
 * Nic to nezakazuje: sazebník patří družstvu, ne aplikaci.
 */
export function findAutoRuleConflict(
	others: readonly OffenceType[],
	rule: AutoRule,
	eventType: AutoEventType,
): AutoRuleConflict | null {
	if (rule === 'none') {
		return null
	}

	const other = others.find((candidate) => {
		if (candidate.archivedAt !== null) {
			return false
		}
		if (toAutoRule(candidate.autoRule) !== rule) {
			return false
		}

		const candidateEventType = toAutoEventType(candidate.autoEventType)

		return candidateEventType === eventType || candidateEventType === 'any' || eventType === 'any'
	})

	if (other === undefined) {
		return null
	}

	const otherEventType = toAutoEventType(other.autoEventType)
	const otherIsAny = otherEventType === 'any'

	return {
		name: other.name,
		soft: otherEventType !== eventType && (otherIsAny || eventType === 'any'),
		otherIsAny,
	}
}
