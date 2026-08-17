import { useEffect, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router'

import { useTeam } from '@/app/team'
import { Avatar } from '@/components/ui/Avatar'
import { Button } from '@/components/ui/Button'
import { Card } from '@/components/ui/Card'
import { ConfirmDialog } from '@/components/ui/ConfirmDialog'
import { ArrowLeftIcon, CarIcon, CheckIcon, MapPinIcon, XIcon } from '@/components/ui/icons'
import { EmptyState, ErrorState, LoadingState } from '@/components/ui/States'
import { AddToCalendarButton } from '@/features/events/AddToCalendarButton'
import {
	canAnswer,
	driverSummary,
	formatEventTime,
	formatTime,
	navigationUrl,
	rsvpLabels,
	sortParticipants,
} from '@/features/events/events'
import { EventTypeBadge } from '@/features/events/EventTypeMark'
import { RsvpButtons } from '@/features/events/RsvpButtons'
import { ApiError } from '@/lib/api'
import { cn } from '@/lib/cn'
import type { AttendanceChange } from '@/lib/queries'
import {
	useCancelEvent,
	useDeleteEvent,
	useEvent,
	useSaveAttendance,
	useSaveNominations,
	useSaveRsvp,
} from '@/lib/queries'
import type { Attendance, EventParticipant, MyParticipation, Nomination, Rsvp, TeamEvent, Transport } from '@/lib/types'
import { attendanceLabels, nominationLabels } from '@/lib/types'

/** Detail akce. Docházka se po začátku nezapisuje, jen opravuje — proto jsou dvě karty „moje odpověď" podle toho, jestli akce běží, nebo už začala. */
export function EventPage() {
	const params = useParams()
	const eventId = Number(params.eventId)
	const validId = Number.isInteger(eventId) && eventId > 0

	const { team, seasonId, isSeasonClosed, can } = useTeam()
	const query = useEvent(validId ? eventId : null)

	if (!validId) {
		return (
			<EmptyState
				title="Neplatná akce"
				description="Odkaz na akci není platný. Vraťte se do kalendáře a zkuste to znovu."
				action={<BackLink />}
			/>
		)
	}

	if (query.isPending) return <LoadingState />
	if (query.error !== null) return <ErrorState error={query.error} onRetry={() => void query.refetch()} />

	const { event, participants, canSeeAttendance } = query.data
	const isTreasurer = can('treasurer')
	const isAdmin = can('admin')
	const writable = !isSeasonClosed

	return (
		<div className="flex flex-col gap-4">
			<BackLink />

			{isSeasonClosed ? (
				<p className="bg-surface-2 text-ink-muted rounded-xl px-3 py-2 text-sm">
					Sezóna je uzavřená — na týhle akci se nedá nic zapisovat.
				</p>
			) : null}

			<EventHeader
				event={event}
				teamName={team?.name ?? 'Družstvo'}
				isAdmin={isAdmin}
				writable={writable}
				eventId={eventId}
				seasonId={seasonId}
			/>

			{/* Sourozenci nesmí sdílet key, jinak si je React při překreslení splete a karta se zdvojí — projevilo se u zápasu, kde vedle sebe stojí odpověď i nominace. */}
			{event.me === null ? null : (
				<MyAnswerCard
					key={`odpoved-${event.id}`}
					event={event}
					me={event.me}
					eventId={eventId}
					seasonId={seasonId}
					writable={writable}
				/>
			)}

			<ParticipantList
				participants={participants}
				started={event.started}
				canSeeAttendance={canSeeAttendance}
				isMatch={event.type === 'match'}
			/>

			{/* Skutečný tok po tréninku: otevřít akci a rovnou zapisovat. */}
			{isTreasurer && event.started && !isSeasonClosed ? (
				<Link
					to={`/zapsat?akce=${event.id}`}
					role="button"
					className="bg-accent text-on-accent inline-flex min-h-12 items-center justify-center rounded-xl px-4 text-sm font-semibold"
				>
					Zapsat prohřešky z téhle akce
				</Link>
			) : null}

			{isTreasurer && event.started ? (
				<AttendanceSection
					key={`dochazka-${event.id}`}
					eventId={eventId}
					seasonId={seasonId}
					participants={participants}
					writable={writable}
					rides={event.type === 'match' && event.isHome !== true}
				/>
			) : null}

			{isAdmin && event.type === 'match' ? (
				<NominationSection
					key={`nominace-${event.id}`}
					eventId={eventId}
					participants={participants}
					writable={writable}
				/>
			) : null}
		</div>
	)
}

function BackLink() {
	return (
		<Link to="/kalendar" className="text-ink-muted hover:text-ink inline-flex items-center gap-1.5 text-sm">
			<ArrowLeftIcon className="size-4" />
			Zpět na kalendář
		</Link>
	)
}

// --- hlavička --------------------------------------------------------------

/** Zrušená akce zůstává v kalendáři s cedulí, smazání je nevratné a je jen pro překlepy. */
type EventAction = 'cancel' | 'restore' | 'delete'

const confirmTitles: Record<EventAction, string> = {
	cancel: 'Zrušit akci?',
	restore: 'Vrátit akci mezi plánované?',
	delete: 'Smazat akci nadobro?',
}

const confirmTexts: Record<EventAction, string> = {
	cancel: 'Zrušená akce zůstane v kalendáři s cedulí „Zrušeno" i s odpověďmi hráčů. Jde ji kdykoli vrátit zpátky.',
	restore: 'Akce se znovu objeví jako plánovaná a půjde na ni odpovídat.',
	delete:
		'Akce zmizí i s odpověďmi hráčů a docházkou a zpátky se vrátit nedá. ' +
		'Zapsané prohřešky zůstanou, jen ztratí vazbu na akci. ' +
		'Pokud se jen nehraje, použijte raději „Zrušit akci".',
}

const confirmLabels: Record<EventAction, string> = {
	cancel: 'Zrušit akci',
	restore: 'Vrátit',
	delete: 'Smazat',
}

interface EventHeaderProps {
	event: TeamEvent
	teamName: string
	isAdmin: boolean
	writable: boolean
	eventId: number
	seasonId: number | null
}

function EventHeader({ event, teamName, isAdmin, writable, eventId, seasonId }: EventHeaderProps) {
	const navigate = useNavigate()
	const cancelEvent = useCancelEvent(eventId, seasonId)
	const deleteEvent = useDeleteEvent(seasonId)
	const [confirming, setConfirming] = useState<'cancel' | 'restore' | 'delete' | null>(null)
	const [error, setError] = useState<string | null>(null)

	const cancelled = event.status === 'cancelled'
	const url = event.location === null ? null : navigationUrl(event.location)

	return (
		<Card className="px-4 py-4">
			<div className="flex flex-wrap items-start justify-between gap-3">
				<div className="min-w-0">
					<div className="flex flex-wrap items-center gap-2">
						<h1 className="text-lg font-semibold">{event.title}</h1>
						<EventTypeBadge type={event.type} />
						{/* Doma / venku rozhoduje o cesťáku, tak ať je to vidět hned v hlavičce. */}
						{event.isHome === null ? null : (
							<span className="bg-surface-2 text-ink-muted rounded-full px-2 py-0.5 text-xs">
								{event.isHome ? 'doma' : 'venku'}
							</span>
						)}
						{cancelled ? (
							<span className="bg-debt-500/15 text-debt rounded-full px-2 py-0.5 text-xs font-medium">Zrušeno</span>
						) : null}
					</div>

					<p className="text-ink-muted mt-1 text-sm">
						{formatEventTime(event.startsAt)}
						{event.endsAt === null ? null : ` – ${formatTime(event.endsAt)}`}
					</p>
					{event.meetAt === null ? null : <p className="text-ink-faint text-sm">sraz v {formatTime(event.meetAt)}</p>}
					{event.opponent === null ? null : <p className="text-ink-muted text-sm">soupeř: {event.opponent}</p>}
					{event.distanceKm === null ? null : (
						<p className="text-ink-faint text-sm">{event.distanceKm} km jedním směrem</p>
					)}
				</div>

				<div className="flex shrink-0 flex-wrap items-center gap-2">
					<AddToCalendarButton events={[event]} teamName={teamName} calendarName={event.title} label="Do kalendáře" />
					{isAdmin ? (
						<>
							<Link
								to={`/akce/${eventId}/upravit`}
								role="button"
								className={cn(
									'bg-surface-2 text-ink inline-flex min-h-11 items-center rounded-xl px-3 text-sm',
									!writable && 'pointer-events-none opacity-50',
								)}
								aria-disabled={writable ? undefined : true}
							>
								Upravit
							</Link>
							<Button
								size="sm"
								variant="ghost"
								disabled={!writable}
								onClick={() => setConfirming(cancelled ? 'restore' : 'cancel')}
							>
								{cancelled ? 'Vrátit mezi plánované' : 'Zrušit akci'}
							</Button>
							<Button size="sm" variant="danger" disabled={!writable} onClick={() => setConfirming('delete')}>
								Smazat
							</Button>
						</>
					) : null}
				</div>
			</div>

			{event.location === null ? null : (
				<div className="border-line/60 mt-3 flex items-start gap-2 border-t pt-3 text-sm">
					<MapPinIcon className="text-ink-faint mt-0.5 size-4" />
					<div className="min-w-0">
						{url === null ? (
							<p>{event.location.name}</p>
						) : (
							<a
								href={url}
								target="_blank"
								rel="noreferrer"
								className="text-brand-600 underline-offset-2 hover:underline"
							>
								{event.location.name}
							</a>
						)}
						{event.location.note === null ? null : <p className="text-ink-faint text-xs">{event.location.note}</p>}
					</div>
				</div>
			)}

			{event.note === null ? null : <p className="text-ink-muted mt-3 text-sm">{event.note}</p>}

			{error === null ? null : (
				<p role="alert" className="text-debt mt-3 text-sm">
					{error}
				</p>
			)}

			<ConfirmDialog
				open={confirming !== null}
				title={confirmTitles[confirming ?? 'cancel']}
				description={confirmTexts[confirming ?? 'cancel']}
				confirmLabel={confirmLabels[confirming ?? 'cancel']}
				danger={confirming !== 'restore'}
				onConfirm={() => {
					const action = confirming
					setConfirming(null)
					setError(null)

					if (action === 'delete') {
						deleteEvent.mutate(eventId, {
							onSuccess: () => void navigate('/kalendar', { replace: true }),
							onError: (cause) => setError(cause instanceof ApiError ? cause.message : 'Akci se nepodařilo smazat.'),
						})

						return
					}

					cancelEvent.mutate(action !== 'restore', {
						onError: (cause) => setError(cause instanceof ApiError ? cause.message : 'Změnu se nepodařilo uložit.'),
					})
				}}
				onCancel={() => setConfirming(null)}
			/>
		</Card>
	)
}

// --- moje odpověď ------------------------------------------------------------

interface RsvpDraft {
	rsvp: Rsvp
	note: string
	transport: Transport
	carSeats: number
}

function draftFrom(me: MyParticipation): RsvpDraft {
	return { rsvp: me.rsvp, note: me.rsvpNote ?? '', transport: me.transport, carSeats: me.carSeats ?? 1 }
}

function clampSeats(value: number): number {
	if (Number.isNaN(value)) return 0

	return Math.min(8, Math.max(0, Math.trunc(value)))
}

// Jen to, co má následek: podle „beru auto" vzniká cesťák a počítají se volná místa.
const transportOptions: Array<{ value: Transport; label: string }> = [
	{ value: 'driver', label: 'Beru auto' },
	{ value: 'none', label: 'Neberu auto' },
]

interface MyAnswerCardProps {
	event: TeamEvent
	me: MyParticipation
	eventId: number
	seasonId: number | null
	writable: boolean
}

function MyAnswerCard({ event, me, eventId, seasonId, writable }: MyAnswerCardProps) {
	const saveRsvp = useSaveRsvp(eventId, seasonId)
	const [draft, setDraft] = useState<RsvpDraft>(() => draftFrom(me))
	const [error, setError] = useState<string | null>(null)

	useEffect(() => {
		setDraft(draftFrom(me))
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [me.rsvp, me.rsvpNote, me.transport, me.carSeats])

	const editable = canAnswer(event) && writable

	function save(next: RsvpDraft) {
		setDraft(next)
		setError(null)
		saveRsvp.mutate(
			{
				rsvp: next.rsvp,
				note: next.note.trim() === '' ? null : next.note.trim(),
				transport: next.transport,
				carSeats: next.transport === 'driver' ? next.carSeats : null,
			},
			{ onError: (cause) => setError(cause instanceof ApiError ? cause.message : 'Odpověď se nepodařilo uložit.') },
		)
	}

	if (!editable) {
		if (event.started) {
			return (
				<Card className="px-4 py-4">
					<h2 className="font-semibold">Moje odpověď</h2>
					<p className="mt-2 text-lg font-medium">
						{me.attendance === null ? 'Zatím bez záznamu' : attendanceLabels[me.attendance]}
					</p>
					{me.rsvpNote === null ? null : <p className="text-ink-faint mt-1 text-sm">{me.rsvpNote}</p>}
					<p className="text-ink-faint mt-2 text-sm">
						Docházka se po začátku akce nezapisuje ručně — případnou opravu dělá pínař.
					</p>
				</Card>
			)
		}

		if (canAnswer(event) && !writable) {
			return (
				<Card className="px-4 py-4">
					<h2 className="font-semibold">Moje odpověď</h2>
					<p className="text-ink-muted mt-2 text-sm">Sezóna je uzavřená, odpověď se teď nedá měnit.</p>
				</Card>
			)
		}

		return null
	}

	return (
		<Card className="px-4 py-4">
			<h2 className="font-semibold">Moje odpověď</h2>

			<div className="mt-3">
				<RsvpButtons
					value={draft.rsvp}
					onChange={(rsvp) => save({ ...draft, rsvp })}
					pending={saveRsvp.isPending ? draft.rsvp : null}
				/>
			</div>

			<label className="mt-3 flex flex-col gap-1.5">
				<span className="text-ink-muted text-sm font-medium">Poznámka</span>
				<textarea
					value={draft.note}
					disabled={saveRsvp.isPending}
					onChange={(event_) => setDraft((current) => ({ ...current, note: event_.target.value }))}
					onBlur={() => save(draft)}
					rows={2}
					placeholder="Nepovinné"
					className="border-line bg-surface-2 text-ink placeholder:text-ink-faint rounded-xl border px-3 py-2.5 text-base"
				/>
			</label>

			{/* Odvozy jen na zápasy venku a jen u toho, kdo přijede — na trénink i do vlastní haly se každý dopraví sám. */}
			{event.type === 'match' && event.isHome !== true && draft.rsvp === 'yes' ? (
				<div className="mt-3 flex flex-col gap-1.5">
					<span className="text-ink-muted text-sm font-medium">Doprava</span>
					<div className="border-line bg-surface-2 flex rounded-xl border p-1">
						{transportOptions.map((option) => (
							<button
								key={option.value}
								type="button"
								disabled={saveRsvp.isPending}
								aria-pressed={draft.transport === option.value}
								onClick={() => save({ ...draft, transport: option.value })}
								className={cn(
									'flex-1 rounded-lg text-sm transition-colors disabled:opacity-40',
									draft.transport === option.value ? 'bg-brand-600 font-medium text-white' : 'text-ink-muted',
								)}
							>
								{option.label}
							</button>
						))}
					</div>

					{draft.transport === 'driver' ? (
						<label className="mt-2 flex items-center gap-3">
							<span className="text-ink-muted text-sm font-medium">Volná místa</span>
							<input
								type="number"
								min={0}
								max={8}
								value={draft.carSeats}
								disabled={saveRsvp.isPending}
								onChange={(event_) => save({ ...draft, carSeats: clampSeats(Number(event_.target.value)) })}
								className="border-line bg-surface-2 text-ink w-20 rounded-xl border px-3 py-2 text-base"
							/>
						</label>
					) : null}
				</div>
			) : null}

			{error === null ? null : (
				<p role="alert" className="text-debt mt-3 text-sm">
					{error}
				</p>
			)}
		</Card>
	)
}

// --- kdo přijde --------------------------------------------------------------

interface ParticipantListProps {
	participants: EventParticipant[]
	started: boolean
	canSeeAttendance: boolean
	isMatch: boolean
}

function ParticipantList({ participants, started, canSeeAttendance, isMatch }: ParticipantListProps) {
	const sorted = sortParticipants(participants)
	const onRosterList = sorted.filter((participant) => participant.onRoster)
	const offRosterList = sorted.filter((participant) => !participant.onRoster)
	const summary = driverSummary(participants)
	const tally = countAnswers(onRosterList)
	const substitutes = onRosterList.filter((participant) => participant.nomination === 'substitute').length

	return (
		<Card className="px-4 py-3">
			<div className="flex flex-wrap items-baseline justify-between gap-2">
				<h2 className="font-semibold">Kdo přijde</h2>
				{summary === null ? null : <p className="text-ink-faint text-sm">{summary}</p>}
			</div>

			{/*
			 * Nominaci sestavuje admin, ale číst ji má celý tým — bez tohohle řádku
			 * by hráč poznal jen to, že u nikoho není štítek, a nevěděl proč.
			 */}
			{isMatch ? (
				<p className="text-ink-muted mt-1 text-sm">
					Nominace: jede {onRosterList.length - substitutes} ze soupisky
					{substitutes === 0 ? '' : `, ${substitutes} jako náhradník`}.
				</p>
			) : null}

			<div className="mt-2 flex flex-wrap gap-1.5">
				<RsvpTally rsvp="yes" count={tally.yes} />
				<RsvpTally rsvp="no" count={tally.no} />
				<RsvpTally rsvp="unknown" count={tally.unknown} />
			</div>

			{onRosterList.length === 0 ? (
				<p className="text-ink-faint mt-2 text-sm">Zatím nikdo neodpověděl.</p>
			) : (
				<div className="mt-2">
					{onRosterList.map((participant) => (
						<ParticipantRow
							key={participant.membershipId}
							participant={participant}
							started={started}
							canSeeAttendance={canSeeAttendance}
							isMatch={isMatch}
						/>
					))}
				</div>
			)}

			{offRosterList.length === 0 ? null : (
				<div className="border-line/60 mt-3 border-t pt-3">
					<p className="text-ink-faint text-xs">Nejsou na aktuální soupisce, ale u téhle akce mají záznam:</p>
					<div className="mt-1 opacity-60">
						{offRosterList.map((participant) => (
							<ParticipantRow
								key={participant.membershipId}
								participant={participant}
								started={started}
								canSeeAttendance={canSeeAttendance}
								isMatch={isMatch}
							/>
						))}
					</div>
				</div>
			)}
		</Card>
	)
}

function countAnswers(participants: EventParticipant[]): Record<Rsvp, number> {
	const tally: Record<Rsvp, number> = { yes: 0, no: 0, unknown: 0 }

	for (const participant of participants) {
		tally[participant.rsvp] += 1
	}

	return tally
}

function RsvpTally({ rsvp, count }: { rsvp: Rsvp; count: number }) {
	return (
		<span className={cn('rounded-full px-2 py-0.5 text-xs font-medium', rsvpStyles[rsvp])}>
			{count} {rsvpLabels[rsvp].toLowerCase()}
		</span>
	)
}

function ParticipantRow({
	participant,
	started,
	canSeeAttendance,
	isMatch,
}: {
	participant: EventParticipant
	started: boolean
	canSeeAttendance: boolean
	isMatch: boolean
}) {
	const showAttendance = started && canSeeAttendance && participant.attendance !== null

	return (
		<div className="border-line/50 flex items-center gap-3 border-b py-2 last:border-b-0">
			<Avatar name={participant.name} jerseyNumber={participant.jerseyNumber} size="sm" />
			<div className="min-w-0 flex-1">
				<p className="truncate text-sm font-medium">{participant.name}</p>
				{participant.rsvpNote === null ? null : (
					<p className="text-ink-faint truncate text-xs">{participant.rsvpNote}</p>
				)}
			</div>

			{/* Nominaci vidí celý tým. Vypisují se jen odchylky — nominovaný je výchozí stav, štítek by byl jen šum. */}
			{isMatch && participant.nomination !== 'nominated' ? (
				<span className="border-line text-ink-muted shrink-0 rounded-full border px-2 py-0.5 text-xs">
					{nominationLabels[participant.nomination]}
				</span>
			) : null}

			{participant.transport === 'driver' ? (
				<span className="text-ink-faint inline-flex items-center gap-1 text-xs">
					<CarIcon className="size-4" />
					{participant.carSeats ?? 0}
				</span>
			) : null}

			{showAttendance && participant.attendance !== null ? (
				<AttendanceBadge attendance={participant.attendance} />
			) : (
				<RsvpBadge rsvp={participant.rsvp} />
			)}
		</div>
	)
}

/** Barva sama nenese informaci — text i ikona nesou tutéž, pozná se to i na černobílé obrazovce. */
const rsvpStyles: Record<Rsvp, string> = {
	yes: 'bg-bonus-500/15 text-bonus',
	no: 'bg-debt-500/15 text-debt',
	unknown: 'bg-surface-2 text-ink-faint',
}

function RsvpBadge({ rsvp }: { rsvp: Rsvp }) {
	return (
		<span
			className={cn(
				'inline-flex shrink-0 items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium',
				rsvpStyles[rsvp],
			)}
		>
			{rsvp === 'yes' ? <CheckIcon className="size-3.5" /> : null}
			{rsvp === 'no' ? <XIcon className="size-3.5" /> : null}
			{rsvpLabels[rsvp]}
		</span>
	)
}

/** Zraněný není ani „byl", ani „nebyl" — do procent se nepočítá, tak ani nesvítí. */
const attendanceStyles: Record<Attendance, string> = {
	present: 'bg-bonus-500/15 text-bonus',
	absent: 'bg-debt-500/15 text-debt',
	injured: 'bg-surface-2 text-ink-muted',
}

function AttendanceBadge({ attendance }: { attendance: Attendance }) {
	return (
		<span
			className={cn(
				'inline-flex shrink-0 items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium',
				attendanceStyles[attendance],
			)}
		>
			{attendance === 'present' ? <CheckIcon className="size-3.5" /> : null}
			{attendance === 'absent' ? <XIcon className="size-3.5" /> : null}
			{attendanceLabels[attendance]}
		</span>
	)
}

// --- docházka ----------------------------------------------------------------

const attendanceOptions: Array<{ value: Attendance; label: string }> = [
	{ value: 'present', label: attendanceLabels.present },
	{ value: 'absent', label: attendanceLabels.absent },
	{ value: 'injured', label: attendanceLabels.injured },
]

interface AttendanceSectionProps {
	eventId: number
	seasonId: number | null
	participants: EventParticipant[]
	writable: boolean
	/** U venkovního zápasu jde zpětně opravit i to, kdo jel autem — jinak nevznikne cesťák. */
	rides: boolean
}

function AttendanceSection({ eventId, seasonId, participants, writable, rides }: AttendanceSectionProps) {
	const saveAttendance = useSaveAttendance(eventId, seasonId)
	const [error, setError] = useState<string | null>(null)

	const pendingMembershipId: number | null =
		saveAttendance.isPending && saveAttendance.variables !== undefined
			? (saveAttendance.variables[0]?.membershipId ?? null)
			: null

	function change(membershipId: number, attendance: Attendance | null) {
		setError(null)
		const items: AttendanceChange[] = [{ membershipId, attendance }]
		saveAttendance.mutate(items, {
			onError: (cause) => setError(cause instanceof ApiError ? cause.message : 'Docházku se nepodařilo uložit.'),
		})
	}

	// Doprava se posílá zvlášť od docházky: `attendance` musí zůstat, jak je,
	// jinak by přepnutí řidiče zrušilo ruční opravu přítomnosti.
	function changeRide(participant: EventParticipant, driver: boolean) {
		setError(null)
		const items: AttendanceChange[] = [
			{
				membershipId: participant.membershipId,
				attendance: participant.corrected ? participant.attendance : null,
				transport: driver ? 'driver' : 'none',
			},
		]
		saveAttendance.mutate(items, {
			onError: (cause) => setError(cause instanceof ApiError ? cause.message : 'Dopravu se nepodařilo uložit.'),
		})
	}

	return (
		<Card className="px-4 py-3">
			<h2 className="font-semibold">Docházka</h2>
			<p className="text-ink-faint mt-1 text-sm">
				Docházka se odvozuje z odpovědí sama — stačí zapsat jen výjimky.
				{rides ? ' Kdo zapomněl říct, že jede autem, se dá doplnit i teď; cesťák pak vznikne sám.' : ''}
			</p>

			<div className="mt-2 flex flex-col gap-2">
				{sortParticipants(participants).map((participant) => {
					const busy = pendingMembershipId === participant.membershipId

					return (
						<div
							key={participant.membershipId}
							className="border-line/50 flex flex-wrap items-center gap-2 border-b py-2 last:border-b-0"
						>
							<Avatar name={participant.name} jerseyNumber={participant.jerseyNumber} size="sm" />
							<div className="min-w-0 flex-1">
								<p className="truncate text-sm font-medium">{participant.name}</p>
								{participant.corrected ? <span className="text-ink-faint text-xs">ručně opraveno</span> : null}
							</div>

							<div className="border-line bg-surface-2 flex rounded-xl border p-1">
								{attendanceOptions.map((option) => (
									<button
										key={option.value}
										type="button"
										disabled={!writable || busy}
										aria-pressed={participant.attendance === option.value}
										onClick={() => change(participant.membershipId, option.value)}
										className={cn(
											'flex-1 rounded-lg px-2 text-sm transition-colors disabled:opacity-40',
											participant.attendance === option.value
												? 'bg-brand-600 font-medium text-white'
												: 'text-ink-muted',
										)}
									>
										{option.label}
									</button>
								))}
							</div>

							{rides && participant.attendance !== 'absent' && participant.attendance !== 'injured' ? (
								<Button
									size="sm"
									variant={participant.transport === 'driver' ? 'accent' : 'ghost'}
									disabled={!writable || busy}
									aria-pressed={participant.transport === 'driver'}
									onClick={() => changeRide(participant, participant.transport !== 'driver')}
								>
									{participant.transport === 'driver' ? 'Jel autem' : 'Jel autem?'}
								</Button>
							) : null}

							{participant.corrected ? (
								<Button
									size="sm"
									variant="ghost"
									disabled={!writable || busy}
									onClick={() => change(participant.membershipId, null)}
								>
									Zrušit opravu
								</Button>
							) : null}
						</div>
					)
				})}
			</div>

			{error === null ? null : (
				<p role="alert" className="text-debt mt-3 text-sm">
					{error}
				</p>
			)}
		</Card>
	)
}

// --- nominace ------------------------------------------------------------

// Pořadí od „jede" po „nejede" — nominovaný je výchozí stav, tak stojí první.
// Jen dva stavy: buď jedeš, nebo jsi náhradník. Nic mezi tím tým nepotřebuje.
const nominationOptions: Array<{ value: Nomination; label: string }> = [
	{ value: 'nominated', label: 'Jede' },
	{ value: 'substitute', label: 'Náhradník' },
]

interface NominationSectionProps {
	eventId: number
	participants: EventParticipant[]
	writable: boolean
}

function NominationSection({ eventId, participants, writable }: NominationSectionProps) {
	const saveNominations = useSaveNominations(eventId)
	const [error, setError] = useState<string | null>(null)
	const [pending, setPending] = useState<number | null>(null)

	// Ukládá se každé kliknutí zvlášť; tlačítko „uložit" jen svádí na to odejít
	// s nominací, o které si člověk myslí, že je hotová.
	function setNomination(membershipId: number, nomination: Nomination) {
		setError(null)
		setPending(membershipId)

		saveNominations.mutate([{ membershipId, nomination }], {
			onError: (cause) => setError(cause instanceof ApiError ? cause.message : 'Nominaci se nepodařilo uložit.'),
			onSettled: () => setPending(null),
		})
	}

	return (
		<Card className="px-4 py-3">
			<h2 className="font-semibold">Nominace</h2>
			<p className="text-ink-faint mt-1 text-sm">
				Jede celá soupiska, stačí vypíchnout náhradníky. Změna se ukládá hned a vidí ji celé družstvo.
			</p>

			<div className="mt-2 flex flex-col gap-2">
				{sortParticipants(participants).map((participant) => (
					<div
						key={participant.membershipId}
						className="border-line/50 flex flex-wrap items-center gap-2 border-b py-2 last:border-b-0"
					>
						<Avatar name={participant.name} jerseyNumber={participant.jerseyNumber} size="sm" />
						<p className="min-w-0 flex-1 truncate text-sm font-medium">{participant.name}</p>

						<div className="border-line bg-surface-2 flex rounded-xl border p-1">
							{nominationOptions.map((option) => (
								<button
									key={option.value}
									type="button"
									disabled={!writable || pending === participant.membershipId}
									aria-pressed={participant.nomination === option.value}
									onClick={() => setNomination(participant.membershipId, option.value)}
									className={cn(
										'min-h-11 flex-1 rounded-lg px-3 text-sm transition-colors disabled:opacity-40',
										participant.nomination === option.value ? 'bg-brand-600 font-medium text-white' : 'text-ink-muted',
									)}
								>
									{option.label}
								</button>
							))}
						</div>
					</div>
				))}
			</div>

			{error === null ? null : (
				<p role="alert" className="text-debt mt-3 text-sm">
					{error}
				</p>
			)}
		</Card>
	)
}
