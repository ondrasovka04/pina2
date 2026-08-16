import type { Season } from '@/lib/types'

export interface SeasonSuggestion {
	name: string
	startsOn: string
	endsOn: string
}

export function addYear(iso: string): string {
	const [year, month, day] = iso.slice(0, 10).split('-').map(Number)
	if (year === undefined || month === undefined || day === undefined) return iso

	const next = new Date(Date.UTC(year + 1, month - 1, day))
	const overflowed = next.getUTCMonth() !== month - 1
	const safe = overflowed ? new Date(Date.UTC(year + 1, month, 0)) : next

	return safe.toISOString().slice(0, 10)
}

function short(year: number): string {
	return String(year % 100).padStart(2, '0')
}

export function nextSeasonName(name: string): string | null {
	const match = /^(\d{2})\/(\d{2})$/.exec(name.trim())
	if (match === null) return null

	const from = Number(match[1])
	const to = Number(match[2])

	return `${short(from + 1)}/${short(to + 1)}`
}

// Podle minulé sezóny (posunuto o rok) nebo dnešního data (září–červen)
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

	const startYear = month >= 7 ? year : year - 1

	return {
		name: `${short(startYear)}/${short(startYear + 1)}`,
		startsOn: `${startYear}-09-01`,
		endsOn: `${startYear + 1}-06-30`,
	}
}
