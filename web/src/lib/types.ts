/**
 * Tvary dat z API.
 *
 * Zatím psané ručně; jakmile bude hotová většina endpointů, vygenerují se
 * z OpenAPI popisu, aby PHP a TypeScript nemohly rozejít.
 */

export type Role = 'player' | 'treasurer' | 'admin'

export const roleLabels: Record<Role, string> = {
	player: 'hráč',
	treasurer: 'pínař',
	admin: 'admin',
}

export interface Membership {
	id: number
	teamId: number
	teamName: string
	clubId: number
	clubName: string
	role: Role
	paymentReference: string
}

export interface CurrentUser {
	id: number
	email: string
	name: string
	platformAdmin: boolean
	memberships: Membership[]
}

export interface LoginResponse {
	accessToken: string
	expiresIn: number
	user: CurrentUser
}

export interface Season {
	id: number
	name: string
	startsOn: string
	endsOn: string
	isCurrent: boolean
	closedAt: string | null
}

export interface OffenceType {
	id: number
	name: string
	amountCzk: number
	sortOrder: number
	category: 'discipline' | 'performance' | 'fun' | 'attendance' | null
	archivedAt: string | null
}

export interface OffenceRecord {
	id: number
	membershipId: number
	offenceTypeId: number
	offenceName: string
	amountCzk: number
	occurredOn: string
	voidedAt: string | null
}

export interface Balance {
	membershipId: number
	name: string
	totalCzk: number
	count: number
}

/**
 * Záporná částka znamená bonus (např. „MVP extraligy" −20 Kč), ne pokutu —
 * v UI se zobrazuje jinou barvou.
 */
export function isBonus(amountCzk: number): boolean {
	return amountCzk < 0
}

export function formatCzk(amountCzk: number): string {
	return new Intl.NumberFormat('cs-CZ', {
		style: 'currency',
		currency: 'CZK',
		maximumFractionDigits: 0,
	}).format(amountCzk)
}

/** Nejvyšší role uživatele v daném týmu; hierarchie admin > treasurer > player. */
export function hasRole(membership: Membership | undefined, required: Role): boolean {
	if (membership === undefined) return false

	const level: Record<Role, number> = { player: 1, treasurer: 2, admin: 3 }
	return level[membership.role] >= level[required]
}
