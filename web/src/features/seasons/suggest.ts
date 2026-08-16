import type { Season } from '@/lib/types'

export interface SeasonSuggestion {
	name: string
	startsOn: string
	endsOn: string
}

/** Přičte rok a ošetří 29. února — v nepřestupném roce spadne na 28. */
export function addYear(iso: string): string {
	const [year, month, day] = iso.slice(0, 10).split('-').map(Number)
	if (year === undefined || month === undefined || day === undefined) return iso

	const next = new Date(Date.UTC(year + 1, month - 1, day))
	// Přetečení pozná podle toho, že si datum přeskočilo do dalšího měsíce.
	const overflowed = next.getUTCMonth() !== month - 1
	const safe = overflowed ? new Date(Date.UTC(year + 1, month, 0)) : next

	return safe.toISOString().slice(0, 10)
}

/** Rok na dvě číslice: 2026 → „26". */
function short(year: number): string {
	return String(year % 100).padStart(2, '0')
}

/** „25/26" → „26/27". Jiný tvar názvu nechá průvodce na uživateli. */
export function nextSeasonName(name: string): string | null {
	const match = /^(\d{2})\/(\d{2})$/.exec(name.trim())
	if (match === null) return null

	const from = Number(match[1])
	const to = Number(match[2])

	return `${short(from + 1)}/${short(to + 1)}`
}

/**
 * Předvyplnění nové sezóny.
 *
 * Když družstvo nějakou sezónu má, jede se podle ní: název o rok dál a stejné
 * období posunuté o rok. Každý tým má vlastní rytmus (junioři začínají v půlce
 * srpna, muži až v září) a hádat za ně jednotné datum by znamenalo, že to admin
 * stejně přepíše.
 *
 * Bez předchozí sezóny se vychází z dnešního data: sezóna začíná v září toho
 * ročníku, do kterého dnešek spadá, a končí koncem června.
 */
export function suggestSeason(previous: Season | null, today: string): SeasonSuggestion {
	if (previous !== null) {
		return {
			name: nextSeasonName(previous.name) ?? '',
			startsOn: addYear(previous.startsOn),
			endsOn: addYear(previous.endsOn),
		}
	}

	const year = Number(today.slice(0, 4))
	const month = Number(today.slice(5, 7))

	// Leden až červen patří ještě k sezóně, která začala loni na podzim.
	const startYear = month >= 7 ? year : year - 1

	return {
		name: `${short(startYear)}/${short(startYear + 1)}`,
		startsOn: `${startYear}-09-01`,
		endsOn: `${startYear + 1}-06-30`,
	}
}
