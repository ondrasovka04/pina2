import type { SubmitEvent } from 'react'
import { useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router'

import { useTeam } from '@/app/team'
import { Button } from '@/components/ui/Button'
import { Card, CardHeader } from '@/components/ui/Card'
import { Field } from '@/components/ui/Field'
import { ArrowLeftIcon } from '@/components/ui/icons'
import { EmptyState, ErrorState, LoadingState } from '@/components/ui/States'
import { parseDateTime, shiftMinutes } from '@/features/events/events'
import { ApiError } from '@/lib/api'
import { cn } from '@/lib/cn'
import type { EventInput } from '@/lib/queries'
import { useCreateLocation, useEvent, useLocations, useUpdateEvent } from '@/lib/queries'
import type { EventType, TeamEvent } from '@/lib/types'
import { eventTypeLabels, eventTypes } from '@/lib/types'

/** Úprava jednoho termínu — formulář kopíruje `NewEventPage`, jen předvyplněný a odesílaný dílem přes PATCH. */
export function EditEventPage() {
	const params = useParams()
	const eventId = Number(params.eventId)
	const validId = Number.isInteger(eventId) && eventId > 0

	const { team, seasonId, can, isSeasonClosed } = useTeam()
	const query = useEvent(validId ? eventId : null)

	if (!validId) {
		return (
			<EmptyState
				title="Neplatná akce"
				description="Odkaz na akci není platný. Vraťte se do kalendáře a zkuste to znovu."
				action={<BackLink eventId={null} />}
			/>
		)
	}

	if (!can('treasurer')) {
		return (
			<EmptyState
				title="Akci upravuje pínař nebo admin"
				description="Kdo tuhle roli má, uvidíte na obrazovce družstva."
			/>
		)
	}

	if (isSeasonClosed) {
		return (
			<EmptyState
				title="Sezóna je uzavřená"
				description="Do uzavřené sezóny se nedají upravovat akce. Přepněte se na otevřenou sezónu."
			/>
		)
	}

	if (query.isPending) return <LoadingState />
	if (query.error !== null) return <ErrorState error={query.error} onRetry={() => void query.refetch()} />

	return (
		<div className="flex flex-col gap-4">
			<div>
				<BackLink eventId={eventId} />
				<h1 className="mt-2 text-xl font-semibold tracking-tight">Úprava akce</h1>
			</div>

			<EditForm
				key={query.data.event.id}
				event={query.data.event}
				eventId={eventId}
				seasonId={seasonId}
				clubId={team?.clubId ?? null}
			/>
		</div>
	)
}

function BackLink({ eventId }: { eventId: number | null }) {
	return (
		<Link
			to={eventId === null ? '/kalendar' : `/akce/${eventId}`}
			className="text-ink-muted inline-flex items-center gap-1.5 text-sm"
		>
			<ArrowLeftIcon className="size-4" />
			{eventId === null ? 'Kalendář' : 'Zpět na akci'}
		</Link>
	)
}

function pad(value: number): string {
	return String(value).padStart(2, '0')
}

/** Server posílá „2026-09-15 19:00:00", `<input type="datetime-local">` chce „2026-09-15T19:00". */
function toInputDateTime(value: string): string {
	const date = parseDateTime(value)
	if (Number.isNaN(date.getTime())) return ''

	return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`
}

/** Rozdíl dvou časů v minutách — pro dopočet délky a srazu do formuláře. */
function diffMinutes(from: string, to: string): number {
	return Math.round((parseDateTime(to).getTime() - parseDateTime(from).getTime()) / 60_000)
}

/** Stejný okamžik bez ohledu na formát (mezera/„T", se sekundami/bez). */
function sameInstant(a: string | null, b: string | null): boolean {
	if (a === null || b === null) return a === b

	return parseDateTime(a).getTime() === parseDateTime(b).getTime()
}

interface EditFormProps {
	event: TeamEvent
	eventId: number
	seasonId: number | null
	clubId: number | null
}

function EditForm({ event, eventId, seasonId, clubId }: EditFormProps) {
	const navigate = useNavigate()
	const update = useUpdateEvent(eventId, seasonId)

	const [type, setType] = useState<EventType>(event.type)
	const [title, setTitle] = useState(event.title)
	const [startsAt, setStartsAt] = useState(toInputDateTime(event.startsAt))
	const [durationMin, setDurationMin] = useState(
		event.endsAt === null ? '' : String(diffMinutes(event.startsAt, event.endsAt)),
	)
	const [meetBeforeMin, setMeetBeforeMin] = useState(
		event.meetAt === null ? '' : String(diffMinutes(event.meetAt, event.startsAt)),
	)
	const [locationId, setLocationId] = useState<number | null>(event.location?.id ?? null)
	const [opponent, setOpponent] = useState(event.opponent ?? '')
	const [distanceKm, setDistanceKm] = useState(event.distanceKm === null ? '' : String(event.distanceKm))
	const [note, setNote] = useState(event.note ?? '')

	async function submit(submitEvent: SubmitEvent<HTMLFormElement>) {
		submitEvent.preventDefault()

		const minutes = Number.parseInt(durationMin, 10)
		const meets = meetBeforeMin.trim() === '' ? null : Number.parseInt(meetBeforeMin, 10)

		const nextEndsAt = Number.isFinite(minutes) ? shiftMinutes(startsAt, minutes) : null
		const nextMeetAt = meets === null || !Number.isFinite(meets) ? null : shiftMinutes(startsAt, -meets)
		const nextTitle = title.trim() === '' ? eventTypeLabels[type] : title.trim()
		const nextNote = note.trim() === '' ? null : note.trim()
		const nextOpponent = type === 'match' && opponent.trim() !== '' ? opponent.trim() : null
		const nextDistanceKm = type === 'match' && distanceKm.trim() !== '' ? Number.parseInt(distanceKm, 10) : null
		const originalLocationId = event.location?.id ?? null

		// PATCH je částečný — posílá se jen to, co se opravdu liší od načtené akce.
		const changes: Partial<EventInput> = {}

		if (type !== event.type) changes.type = type
		if (nextTitle !== event.title) changes.title = nextTitle
		if (!sameInstant(startsAt, event.startsAt)) changes.startsAt = startsAt
		if (!sameInstant(nextEndsAt, event.endsAt)) changes.endsAt = nextEndsAt
		if (!sameInstant(nextMeetAt, event.meetAt)) changes.meetAt = nextMeetAt
		if (locationId !== originalLocationId) changes.locationId = locationId
		if (nextOpponent !== event.opponent) changes.opponent = nextOpponent
		if (nextDistanceKm !== event.distanceKm) changes.distanceKm = nextDistanceKm
		if (nextNote !== event.note) changes.note = nextNote

		if (Object.keys(changes).length > 0) {
			await update.mutateAsync(changes)
		}

		await navigate(`/akce/${eventId}`, { replace: true })
	}

	return (
		<form onSubmit={submit} noValidate className="flex flex-col gap-4">
			{/* Odkaz na sérii tu musí být — jinak by ho, kdo chce posunout všechny termíny, hledal v menu družstva. */}
			{event.seriesId === null ? null : (
				<p className="bg-surface-2 text-ink-muted rounded-xl px-3 py-2 text-sm">
					Akce patří do opakované série — úprava platí jen pro tenhle termín a odpojí ho od hromadné změny série.{' '}
					<Link to="/serie" className="text-accent underline-offset-2 hover:underline">
						Změnit celou sérii
					</Link>
				</p>
			)}

			<Card>
				<CardHeader title="Kdy a co" />
				<div className="flex flex-col gap-4 p-4">
					<TypePicker value={type} onChange={setType} />

					<Field
						label="Název"
						value={title}
						onChange={(fieldEvent) => setTitle(fieldEvent.target.value)}
						placeholder={eventTypeLabels[type]}
						hint="Když necháte prázdné, použije se druh akce."
						maxLength={120}
					/>

					<Field
						label="Začátek"
						type="datetime-local"
						value={startsAt}
						onChange={(fieldEvent) => setStartsAt(fieldEvent.target.value)}
						required
					/>

					<div className="grid grid-cols-2 gap-3">
						<Field
							label="Délka (min)"
							type="number"
							inputMode="numeric"
							min={15}
							max={720}
							value={durationMin}
							onChange={(fieldEvent) => setDurationMin(fieldEvent.target.value)}
						/>
						<Field
							label="Sraz předem (min)"
							type="number"
							inputMode="numeric"
							min={0}
							max={720}
							value={meetBeforeMin}
							onChange={(fieldEvent) => setMeetBeforeMin(fieldEvent.target.value)}
							placeholder="—"
						/>
					</div>
				</div>
			</Card>

			<LocationCard clubId={clubId} value={locationId} onChange={setLocationId} />

			{type === 'match' ? (
				<Card>
					<CardHeader title="Zápas" subtitle="Vzdálenost je podklad pro cesťák — jednosměrná, od domácí haly." />
					<div className="flex flex-col gap-4 p-4">
						<Field label="Soupeř" value={opponent} onChange={(fieldEvent) => setOpponent(fieldEvent.target.value)} />
						<Field
							label="Vzdálenost (km)"
							type="number"
							inputMode="numeric"
							min={0}
							max={2000}
							value={distanceKm}
							onChange={(fieldEvent) => setDistanceKm(fieldEvent.target.value)}
							placeholder="—"
						/>
					</div>
				</Card>
			) : null}

			<NoteField value={note} onChange={setNote} />

			<ErrorLine error={update.error} />

			<Button type="submit" variant="accent" size="lg" fullWidth loading={update.isPending}>
				Uložit změny
			</Button>
		</form>
	)
}

function TypePicker({ value, onChange }: { value: EventType; onChange: (value: EventType) => void }) {
	return (
		<fieldset className="flex flex-col gap-1.5">
			<legend className="text-ink-muted text-sm font-medium">Druh</legend>
			<div className="bg-surface-2 mt-1 flex gap-1 rounded-xl p-1">
				{eventTypes.map((eventType) => (
					<button
						key={eventType}
						type="button"
						aria-pressed={value === eventType}
						onClick={() => onChange(eventType)}
						className={cn(
							'min-h-11 flex-1 rounded-lg px-2 text-sm transition-colors',
							value === eventType ? 'bg-surface-0 text-ink font-medium' : 'text-ink-muted',
						)}
					>
						{eventTypeLabels[eventType]}
					</button>
				))}
			</div>
		</fieldset>
	)
}

/** Místa patří klubu, takže halu založenou u mužů uvidí i junioři. */
function LocationCard({
	clubId,
	value,
	onChange,
}: {
	clubId: number | null
	value: number | null
	onChange: (value: number | null) => void
}) {
	const locations = useLocations(clubId)
	const create = useCreateLocation(clubId ?? 0)

	const [adding, setAdding] = useState(false)
	const [name, setName] = useState('')
	const [address, setAddress] = useState('')

	async function add() {
		if (clubId === null || name.trim() === '') return

		const created = await create.mutateAsync({
			name: name.trim(),
			address: address.trim() === '' ? null : address.trim(),
		})

		onChange(created.id)
		setAdding(false)
		setName('')
		setAddress('')
	}

	return (
		<Card>
			<CardHeader title="Místo" subtitle="Sdílené celým klubem." />
			<div className="flex flex-col gap-3 p-4">
				<select
					value={value ?? ''}
					onChange={(event) => onChange(event.target.value === '' ? null : Number.parseInt(event.target.value, 10))}
					className="border-line bg-surface-2 text-ink min-h-11 rounded-xl border px-3 text-base"
					aria-label="Místo konání"
				>
					<option value="">Neurčeno</option>
					{(locations.data ?? []).map((location) => (
						<option key={location.id} value={location.id}>
							{location.name}
						</option>
					))}
				</select>

				{adding ? (
					<div className="border-line/60 flex flex-col gap-3 rounded-xl border p-3">
						<Field label="Název haly" value={name} onChange={(event) => setName(event.target.value)} />
						<Field
							label="Adresa"
							value={address}
							onChange={(event) => setAddress(event.target.value)}
							placeholder="Litoměřická 987/1, Praha 9"
							hint="Podle adresy se pak dá pustit navigace."
						/>
						<ErrorLine error={create.error} />
						<div className="flex gap-2">
							<Button onClick={() => void add()} loading={create.isPending} disabled={name.trim() === ''}>
								Přidat
							</Button>
							<Button variant="ghost" onClick={() => setAdding(false)}>
								Zpět
							</Button>
						</div>
					</div>
				) : (
					<Button variant="ghost" onClick={() => setAdding(true)} disabled={clubId === null}>
						Přidat nové místo
					</Button>
				)}
			</div>
		</Card>
	)
}

function NoteField({ value, onChange }: { value: string; onChange: (value: string) => void }) {
	return (
		<Card>
			<CardHeader title="Poznámka" subtitle="Uvidí ji celé družstvo u akce." />
			<div className="p-4">
				<textarea
					value={value}
					onChange={(event) => onChange(event.target.value)}
					rows={3}
					className="border-line bg-surface-2 text-ink placeholder:text-ink-faint w-full rounded-xl border px-3 py-2.5 text-base"
					placeholder="Vezměte si tmavé dresy."
					aria-label="Poznámka k akci"
				/>
			</div>
		</Card>
	)
}

/** Hláška ze serveru je konkrétnější než cokoli, co bychom vymysleli tady. */
function ErrorLine({ error }: { error: unknown }) {
	if (error === null || error === undefined) return null

	return (
		<p role="alert" className="bg-debt-500/15 text-debt rounded-xl px-3 py-2 text-sm">
			{error instanceof ApiError ? error.message : 'Uložení se nepodařilo.'}
		</p>
	)
}
