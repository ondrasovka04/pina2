import type { ActivationBatch, Role, TeamMember } from '@/lib/types'

// Aktivní nahoře, odešlí dole.
const statusOrder = { active: 0, left: 1 } as const

export function sortMembers(members: TeamMember[]): TeamMember[] {
	return members.toSorted((a, b) => {
		const byStatus = statusOrder[a.status] - statusOrder[b.status]

		return byStatus === 0 ? a.name.localeCompare(b.name, 'cs') : byStatus
	})
}

// Kdo se ještě nikdy nepřihlásil — bez hesla, potřebuje aktivační odkaz.
export function needsActivation(member: TeamMember): boolean {
	return !member.hasPassword && member.status !== 'left'
}

// Posledního admina nemůžeme degradovat — server by vrátil 409 LAST_ADMIN.
export function isLastAdmin(member: TeamMember, members: TeamMember[]): boolean {
	if (member.role !== 'admin' || member.status === 'left') return false

	return !members.some((other) => other.id !== member.id && other.role === 'admin' && other.status !== 'left')
}

export const roleOrder: Role[] = ['player', 'treasurer', 'admin']

// Výsledek hromadného rozeslání — musí být upřímný o selhání.
export function describeBatch(result: ActivationBatch): string {
	const parts: string[] = [`Odesláno ${result.sent}`]

	if (result.failed > 0) parts.push(`${result.failed} neodešlo`)
	if (result.skipped > 0) parts.push(`${result.skipped} bez použitelné adresy`)

	const zbyva = result.remaining + result.failed

	return zbyva === 0 ? `${parts.join(', ')}. Hotovo.` : `${parts.join(', ')}. Zbývá ${zbyva} — zmáčkněte znovu.`
}

// Absolutní odkaz — posílá se do chatu, musí obsahovat doménu.
export function invitationUrl(token: string, origin: string): string {
	return `${origin}/pozvanka?token=${encodeURIComponent(token)}`
}
