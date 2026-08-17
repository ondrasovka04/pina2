/** Tvary dat z API — psané ručně podle `@phpstan-type` anotací v `api/src/Service`, dokud se negenerují z OpenAPI. */

export type Role = 'player' | 'treasurer' | 'admin'

export const roleLabels: Record<Role, string> = {
	player: 'hráč',
	treasurer: 'pínař',
	admin: 'admin',
}

/** Členství je buď živé, nebo skončené — mezistav se neosvědčil, viz api/AGENTS.md. */
export type MemberStatus = 'active' | 'left'

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
	/** Umí nasazení odesílat poštu? Bez toho se odkazy předávají ručně. */
	mailEnabled: boolean
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
	/**
	 * Datum, kterým se sezóna dělí na pololetí. `null` znamená, že se pololetí
	 * neřeší. Nic se tím nezamyká, je to jen hranice pro členění čísel.
	 */
	halfYearOn: string | null
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
	/** `false` = účet z migrace, který se ještě nikdy nepřihlásil. */
	hasPassword: boolean
}

export const memberStatusLabels: Record<MemberStatus, string> = {
	active: 'aktivní',
	left: 'odešel',
}

/** Nevyzvednutá pozvánka. Token se vrací jen jednou při vytvoření, tady nikdy. */
export interface TeamInvitation {
	id: number
	email: string
	role: Role
	expiresAt: string
	expired: boolean
	createdAt: string
}

/** Odkaz vydaný na jedno použití — po zavření dialogu už ho nelze znovu zobrazit. */
export interface IssuedLink {
	email: string
	role: Role
	expiresAt: string
	token: string
	/** `false` = zpráva neodešla, odkaz je potřeba předat ručně. */
	emailSent: boolean
}

/** Výsledek hromadného rozeslání aktivačních e-mailů. */
export interface ActivationBatch {
	sent: number
	failed: number
	/** Kolik lidí ještě odkaz nemá — dávka je omezená, tlačítko se mačká víckrát. */
	remaining: number
	/** Účty bez použitelné e-mailové adresy. */
	skipped: number
}

/**
 * Provozní přehled pro správce platformy. Schválně obsahuje jen čísla o zdraví
 * klubu — dluhy ani jména cizích hráčů se tudy nevydávají.
 */
export interface PlatformClub {
	id: number
	name: string
	slug: string
	teams: PlatformTeam[]
}

export interface PlatformTeam {
	id: number
	name: string
	archived: boolean
	memberCount: number
	/** Kolik má družstvo adminů. Nula znamená, že se samo nespraví. */
	adminCount: number
	/** Kolik členů se už někdy přihlásilo. */
	activatedCount: number
	seasonCount: number
	currentSeason: string | null
}

/**
 * Nastavení družstva. Cesťáky jsou volitelné — mládež je řešit nemusí.
 * Pololetí se tady neřeší, jeho hranici drží `Season.halfYearOn`.
 */
export interface TeamSettings {
	travelEnabled: boolean
	travelRateCzkKm: number
	/** Proplácí se cesta tam i zpět (× 2). */
	travelRoundTrip: boolean
	/** Domácí hala. Od ní se měří vzdálenost k soupeři a podle ní se pozná domácí zápas. */
	homeLocationId: number | null
	attendanceVisibleToPlayers: boolean
	balancesVisibleToPlayers: boolean
	/** Společný účet klubu pro QR platby. */
	bankAccount: string | null
}

export interface TeamDetail {
	id: number
	name: string
	color: string | null
	archivedAt: string | null
	clubId: number
	clubName: string
	memberCount: number
	settings: TeamSettings
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

/**
 * Co aplikace navrhne sama z docházky. Omluvenou a neomluvenou absenci rozlišuje
 * odpověď hráče předem — kdo řekl „nepřijdu", omluvil se. Pozdní příchod se
 * odvodit nedá (nikdo nezapisuje čas příchodu) a zůstává ruční.
 */
export const autoRules = ['none', 'excused_absence', 'unexcused_absence'] as const

export type AutoRule = (typeof autoRules)[number]

export const autoRuleLabels: Record<AutoRule, string> = {
	none: 'Nenavrhovat',
	excused_absence: 'Omluvená absence',
	unexcused_absence: 'Neomluvená absence',
}

/** Ověří hodnotu ze `<select>`; co nepoznáme, znamená „nenavrhovat". */
export function toAutoRule(value: string): AutoRule {
	return autoRules.find((rule) => rule === value) ?? 'none'
}

/**
 * U kterého druhu akce pravidlo platí. Každé družstvo má za trénink a za zápas
 * jinou sazbu (junioři 25/100, muži 35/100, Benátky 50/1000), takže bez tohohle
 * by návrh z docházky strhl částku o stovky vedle.
 */
export const autoEventTypes = ['any', 'training', 'match', 'other'] as const

export type AutoEventType = (typeof autoEventTypes)[number]

export const autoEventTypeLabels: Record<AutoEventType, string> = {
	any: 'U každé akce',
	training: 'Jen u tréninku',
	match: 'Jen u zápasu',
	other: 'Jen u jiné akce',
}

export function toAutoEventType(value: string): AutoEventType {
	return autoEventTypes.find((type) => type === value) ?? 'any'
}

export interface OffenceType {
	id: number
	seasonId: number
	name: string
	amountCzk: number
	sortOrder: number
	category: OffenceCategory | null
	autoRule: string
	autoEventType: string
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
	offencesCzk: number
	bonusesCzk: number
	paidCzk: number
	travelCzk: number
	balanceCzk: number
	/**
	 * Rozpad na pololetí podle data zápisu, platby a cesťáku. `null`, když sezóna
	 * přelom nastavený nemá. Ploché hodnoty výše jsou vždycky součet obou polovin.
	 */
	halves: { first: BalanceSums; second: BalanceSums } | null
}

/** Součty za jedno období. `balanceCzk` = prohřešky + bonusy − platby − cesťáky. */
export interface BalanceSums {
	offencesCzk: number
	bonusesCzk: number
	paidCzk: number
	travelCzk: number
	balanceCzk: number
	recordCount: number
}

export type PeriodKey = 'all' | 'first' | 'second'

export interface BalancePeriod {
	key: PeriodKey
	label: string
	from: string
	to: string
}

export interface BalanceList {
	seasonId: number
	visibility: 'own' | 'team'
	halfYearOn: string | null
	/** Vždy obsahuje `all`; `first` a `second` jen když je nastavený přelom. */
	periods: BalancePeriod[]
	totals: BalanceSums
	halves: { first: BalanceSums; second: BalanceSums } | null
	totalCzk: number
	offencesCzk: number
	bonusesCzk: number
	paidCzk: number
	travelCzk: number
	members: MemberBalance[]
}

export type PaymentMethod = 'cash' | 'transfer' | 'qr' | 'gateway'

export interface Payment {
	id: number
	seasonId: number
	membershipId: number
	memberName: string
	amountCzk: number
	paidOn: string
	method: PaymentMethod
	variableSymbol: string | null
	note: string | null
	confirmedBy: { id: number; name: string } | null
	createdAt: string
	voidedAt: string | null
}

export interface TravelClaim {
	id: number
	seasonId: number
	membershipId: number
	memberName: string
	eventId: number | null
	eventTitle: string | null
	occurredOn: string
	distanceKm: number
	rateCzkKm: number
	amountCzk: number
	note: string | null
	createdAt: string
	voidedAt: string | null
}

export interface PaymentQr {
	membershipId: number
	amountCzk: number
	variableSymbol: string
	bankAccount: string | null
	spayd: string | null
	/**
	 * Popis období, do kterého platba spadá. `half` říká, v jakém pololetí právě
	 * jsme — částka je ale vždy celý neuhrazený zůstatek sezóny, ne jen ta polovina.
	 */
	period: { name: string; from: string; to: string; half: 'first' | 'second' | null }
}

export interface TravelSyncResult {
	created: number
	updated: number
	voided: number
	items: TravelClaim[]
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

// --- docházka ------------------------------------------------------------

export const eventTypes = ['training', 'match', 'other'] as const

export type EventType = (typeof eventTypes)[number]

export const eventTypeLabels: Record<EventType, string> = {
	training: 'Trénink',
	match: 'Zápas',
	other: 'Jiná akce',
}

/** Co hráč řekl předem. `unknown` = nezaklikl se. */
export type Rsvp = 'unknown' | 'yes' | 'no'

/**
 * Výsledný stav docházky. `null` znamená, že akce ještě nezačala nebo je
 * zrušená — ne že by se stav nezjistil.
 */
export type Attendance = 'present' | 'absent' | 'injured'

export const attendanceLabels: Record<Attendance, string> = {
	present: 'Byl',
	absent: 'Nebyl',
	injured: 'Zraněný',
}

/** Nominace na zápas. Dokud nikdo nesestavil, server vrací všem `nominated` (jede celá soupiska). Po prvním
 * uložení `none` znamená „nejede", ne „ještě se neřešilo". */
export type Nomination = 'none' | 'nominated' | 'substitute'

export const nominationLabels: Record<Nomination, string> = {
	nominated: 'Jede',
	substitute: 'Náhradník',
	// U tréninku se nominace neřeší; server tam vrací `none`.
	none: '—',
}

/** Beru auto, nebo neberu. Nic mezi tím nemá v aplikaci žádný následek. */
export type Transport = 'none' | 'driver'

export type EventStatus = 'planned' | 'cancelled' | 'done'

export interface EventLocation {
	id: number
	name: string
	address: string | null
	lat: number | null
	lng: number | null
	note: string | null
}

/** Místo i s tím, kolika akcím slouží — bez toho by šlo smazat používanou halu. */
export interface ClubLocation extends EventLocation {
	clubId: number
	usedByEvents: number
}

/** Vlastní řádek u akce. `null`, když volající do družstva nepatří. */
export interface MyParticipation {
	membershipId: number
	rsvp: Rsvp
	rsvpNote: string | null
	nomination: Nomination
	transport: Transport
	carSeats: number | null
	attendance: Attendance | null
}

export interface TeamEvent {
	id: number
	seasonId: number
	seriesId: number | null
	type: EventType
	title: string
	startsAt: string
	endsAt: string | null
	meetAt: string | null
	location: EventLocation | null
	opponent: string | null
	note: string | null
	distanceKm: number | null
	nominationDeadline: string | null
	status: EventStatus
	/** Hraje se doma? `null` = nedá se říct (trénink, chybějící místo nebo domácí hala). Za domácí zápas cesťák nevzniká. */
	isHome: boolean | null
	/** Akce už začala — odpověď se nedá měnit a platí docházka. */
	started: boolean
	/** Termín ze série někdo ručně upravil; hromadná změna série ho přeskočí. */
	overridden: boolean
	rosterCount: number
	counts: { yes: number; no: number; unknown: number }
	me: MyParticipation | null
}

export interface EventParticipant {
	membershipId: number
	userId: number
	name: string
	jerseyNumber: number | null
	/** `false` = na soupisce sezóny není, ale u akce záznam má. */
	onRoster: boolean
	nomination: Nomination
	rsvp: Rsvp
	rsvpNote: string | null
	transport: Transport
	carSeats: number | null
	attendance: Attendance | null
	/** Docházku někdo ručně přepsal — jinak platí odvození z odpovědi. */
	corrected: boolean
}

export interface EventDetail {
	event: TeamEvent
	participants: EventParticipant[]
	/** Hráč docházku ostatních nevidí, dokud ji admin neotevře v nastavení. */
	canSeeAttendance: boolean
}

export interface EventSeries {
	id: number
	seasonId: number
	title: string
	type: EventType
	rrule: string
	startTime: string
	durationMin: number
	location: EventLocation | null
	meetBeforeMin: number | null
	defaultNote: string | null
	activeFrom: string
	activeTo: string
	eventCount: number
}

export interface AttendanceRow {
	membershipId: number
	userId: number
	name: string
	jerseyNumber: number | null
	present: number
	absent: number
	injured: number
	/** Jmenovatel účasti: zranění se do něj nepočítá. */
	total: number
	ratio: number | null
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
		// Bez tohohle vypíše Intl „-0 Kč": obrazovky obracejí znaménko (zaplaceno,
		// cesťáky) a negace nuly je v JS -0, což se od 0 nedá porovnáním poznat.
	}).format(amountCzk === 0 ? 0 : amountCzk)
}

/** „2026-08-16" → „16. 8. 2026". Na vstupu je vždy datum bez času z MySQL. */
export function formatDate(iso: string): string {
	const date = new Date(`${iso.slice(0, 10)}T00:00:00`)

	return Number.isNaN(date.getTime()) ? iso : new Intl.DateTimeFormat('cs-CZ').format(date)
}

/** „2026-08-19 14:30:00" → „19. 8. 2026 14:30" — používá se u platnosti odkazů, kde je rozdíl mezi ránem a večerem
 * podstatný. Mezera se mění na „T", jinak by to Safari přečetlo jako neplatné datum. */
export function formatDateTime(iso: string): string {
	const date = new Date(iso.replace(' ', 'T'))

	return Number.isNaN(date.getTime())
		? iso
		: new Intl.DateTimeFormat('cs-CZ', { dateStyle: 'short', timeStyle: 'short' }).format(date)
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
