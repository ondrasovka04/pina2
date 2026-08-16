/**
 * Tvary dat z API.
 *
 * Zatím psané ručně a udržované podle `@phpstan-type` anotací v `api/src/Service`;
 * jakmile bude hotová většina endpointů, vygenerují se z OpenAPI popisu, aby se
 * PHP a TypeScript nemohly rozejít.
 */

export type Role = 'player' | 'treasurer' | 'admin'

export const roleLabels: Record<Role, string> = {
	player: 'hráč',
	treasurer: 'pínař',
	admin: 'admin',
}

export type MemberStatus = 'active' | 'suspended' | 'left'

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

/** Položka z `/me/teams` — tým očima přihlášeného, včetně jeho role. */
export interface TeamSummary {
	id: number
	name: string
	color: string | null
	clubId: number
	clubName: string
	membershipId: number
	role: Role
	archived: boolean
	currentSeason: { id: number; name: string } | null
}

export interface Season {
	id: number
	teamId: number
	name: string
	startsOn: string
	endsOn: string
	isCurrent: boolean
	closedAt: string | null
	rosterCount: number
}

/** Musí odpovídat `OffenceTypeService::CATEGORIES`. Pořadí určuje i pořadí sekcí v sazebníku. */
export const offenceCategories = ['discipline', 'performance', 'fun', 'attendance'] as const

/** Kdo je na soupisce sezóny. Členství přetrvává, soupiska se dělá každou sezónu znovu. */
export interface RosterEntry {
	membershipId: number
	userId: number
	name: string
	role: Role
	status: MemberStatus
	jerseyNumber: number | null
	paymentReference: string
}

/** Člen družstva napříč sezónami — zdroj, ze kterého se soupiska sestavuje. */
export interface TeamMember {
	id: number
	userId: number
	name: string
	email: string
	role: Role
	status: MemberStatus
	jerseyNumber: number | null
	paymentReference: string
	joinedAt: string
}

export type OffenceCategory = (typeof offenceCategories)[number]

export const categoryLabels: Record<OffenceCategory, string> = {
	discipline: 'Kázeň',
	performance: 'Výkon',
	fun: 'Sranda',
	attendance: 'Docházka',
}

/** Ověří hodnotu z `<select>`; prázdný řetězec znamená „bez kategorie". */
export function toCategory(value: string): OffenceCategory | '' {
	return offenceCategories.find((category) => category === value) ?? ''
}

export interface OffenceType {
	id: number
	seasonId: number
	name: string
	amountCzk: number
	sortOrder: number
	category: OffenceCategory | null
	autoRule: string
	archivedAt: string | null
}

export interface OffenceRecord {
	id: number
	seasonId: number
	membershipId: number
	memberName: string
	offenceTypeId: number
	offenceTypeName: string
	amountCzk: number
	occurredOn: string
	batchId: number | null
	eventId: number | null
	note: string | null
	createdAt: string
	voidedAt: string | null
}

export interface RecordList {
	items: OffenceRecord[]
	count: number
	totalCzk: number
}

export interface MemberBalance {
	membershipId: number
	userId: number
	name: string
	jerseyNumber: number | null
	status: MemberStatus
	/**
	 * Je na soupisce téhle sezóny. `false` znamená, že už za tým nehraje,
	 * ale zůstal po něm dluh — takový řádek se v přehledu odliší.
	 */
	onRoster: boolean
	recordCount: number
	balanceCzk: number
}

export interface BalanceList {
	seasonId: number
	totalCzk: number
	members: MemberBalance[]
}

// --- dávkový zápis -------------------------------------------------------

export interface BatchItem {
	offenceTypeId: number
	name: string
	amountCzk: number
	count: number
	voidedCount: number
	totalCzk: number
}

export interface BatchMember {
	membershipId: number
	userId: number
	name: string
	recordCount: number
	voidedCount: number
	totalCzk: number
	/** Zůstatek hráče po započtení téhle dávky. */
	balanceCzk: number
	items: BatchItem[]
}

export interface Batch {
	id: number
	seasonId: number
	eventId: number | null
	occurredOn: string
	title: string | null
	note: string | null
	clientUuid: string
	createdBy: { id: number; name: string } | null
	createdAt: string
	voidedAt: string | null
	voidedBy: number | null
}

export interface BatchSummary {
	batch: Batch
	totalCzk: number
	recordCount: number
	voidedRecordCount: number
	memberCount: number
	members: BatchMember[]
}

/** Tělo požadavku na dávkový zápis. */
export interface BatchInput {
	clientUuid: string
	occurredOn: string
	title?: string | null
	note?: string | null
	eventId?: number | null
	items: Array<{
		membershipId: number
		offenceTypeId: number
		count: number
		note?: string | null
		/**
		 * Cena, kterou klient ukázal v souhrnu. Když se mezitím změnil sazebník,
		 * server odmítne zápis s 409 místo aby potichu zapsal jinou částku.
		 */
		expectedAmountCzk: number
	}>
}

/** Detail konfliktu, který server vrátí u 409 PRICE_CHANGED. */
export interface PriceChange {
	offenceTypeId: number
	name: string
	expectedCzk: number
	currentCzk: number
}

// --- pomocné funkce ------------------------------------------------------

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

/** „2026-08-16" → „16. 8. 2026". Na vstupu je vždy datum bez času z MySQL. */
export function formatDate(iso: string): string {
	const date = new Date(`${iso.slice(0, 10)}T00:00:00`)

	return Number.isNaN(date.getTime()) ? iso : new Intl.DateTimeFormat('cs-CZ').format(date)
}

/** Dnešek ve tvaru `YYYY-MM-DD` v místním čase — `toISOString()` by posunul přes půlnoc. */
export function today(): string {
	const now = new Date()
	const month = String(now.getMonth() + 1).padStart(2, '0')
	const day = String(now.getDate()).padStart(2, '0')

	return `${now.getFullYear()}-${month}-${day}`
}

const roleLevel: Record<Role, number> = { player: 1, treasurer: 2, admin: 3 }

/** Hierarchie rolí: admin > pínař > hráč. */
export function atLeast(role: Role | undefined, required: Role): boolean {
	if (role === undefined) return false

	return roleLevel[role] >= roleLevel[required]
}

export function hasRole(membership: Membership | undefined, required: Role): boolean {
	return atLeast(membership?.role, required)
}
