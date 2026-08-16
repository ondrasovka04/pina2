import type { Role, TeamMember } from '@/lib/types'

/**
 * Pořadí ve výpisu členů. Aktivní nahoře, odešlí dole — družstvo si za deset let
 * nasbírá víc bývalých než současných hráčů a admin řeší skoro vždy ty současné.
 */
const statusOrder = { active: 0, suspended: 1, left: 2 } as const

export function sortMembers(members: TeamMember[]): TeamMember[] {
	return members.toSorted((a, b) => {
		const byStatus = statusOrder[a.status] - statusOrder[b.status]

		return byStatus === 0 ? a.name.localeCompare(b.name, 'cs') : byStatus
	})
}

/**
 * Kdo se ještě nikdy nepřihlásil. Hesla se ze staré aplikace nepřenášela
 * (byly to nesolené SHA-256 otisky), takže těmhle lidem musí admin vyrobit
 * aktivační odkaz — jinak se do aplikace nedostanou.
 */
export function needsActivation(member: TeamMember): boolean {
	return !member.hasPassword && member.status !== 'left'
}

/**
 * Je tenhle člen posledním adminem družstva?
 *
 * Server to hlídá taky (409 `LAST_ADMIN`), tady jde jen o to, aby se akce dala
 * zakázat dopředu — nabídnout tlačítko, které vždycky skončí chybou, je horší
 * než ho neukázat.
 */
export function isLastAdmin(member: TeamMember, members: TeamMember[]): boolean {
	if (member.role !== 'admin' || member.status === 'left') return false

	return !members.some((other) => other.id !== member.id && other.role === 'admin' && other.status !== 'left')
}

export const roleOrder: Role[] = ['player', 'treasurer', 'admin']

/**
 * Absolutní odkaz na přijetí pozvánky. Posílá se do chatu, takže musí obsahovat
 * i doménu — relativní cesta by se v aplikaci pro zprávy neproklikla.
 */
export function invitationUrl(token: string, origin: string): string {
	return `${origin}/pozvanka?token=${encodeURIComponent(token)}`
}
