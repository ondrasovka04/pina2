import type { SubmitEvent } from 'react'
import { useState } from 'react'
import { Link, useNavigate } from 'react-router'

import { useTeam } from '@/app/team'
import { NoSeasonState } from '@/components/NoSeasonState'
import { Button } from '@/components/ui/Button'
import { Card, CardHeader } from '@/components/ui/Card'
import { Field } from '@/components/ui/Field'
import { ArrowLeftIcon } from '@/components/ui/icons'
import { Select } from '@/components/ui/Select'
import { EmptyState } from '@/components/ui/States'
import type { Weekday } from '@/features/events/events'
import {
	buildRrule,
	describeRrule,
	formatDeadline,
	inheritedDeadlineAt,
	shiftMinutes,
	todayOrLater,
	weekdayLabels,
	weekdays,
} from '@/features/events/events'
import { TravelLinkField } from '@/features/events/TravelLinkField'
import { ApiError } from '@/lib/api'
import { cn } from '@/lib/cn'
import {
	useCreateEvent,
	useCreateLocation,
	useCreateSeries,
	useEvents,
	useLocations,
	useTeamDetail,
} from '@/lib/queries'
import type { EventType } from '@/lib/types'
import { eventTypeLabels, eventTypes } from '@/lib/types'

/**
 * Založení akce — jednoho termínu, nebo celé opakované série. Série se materializuje hned
 * při uložení, protože odpovědi hráčů se váží na konkrétní termín, ne na pravidlo.
 */
export function NewEventPage() {
	const { team, season, seasonId, can, isSeasonClosed } = useTeam()
	const [repeats, setRepeats] = useState(false)

	if (seasonId === null || season === null) {
		return <NoSeasonState what="akce" />
	}

	if (!can('treasurer')) {
		return (
			<EmptyState
				title="Akce zakládá pínař nebo admin"
				description="Kdo tuhle roli má, uvidíte na obrazovce družstva."
			/>
		)
	}

	if (isSeasonClosed) {
		return (
			<EmptyState
				title="Sezóna je uzavřená"
				description="Do uzavřené sezóny se nedají přidávat akce. Přepněte se na otevřenou sezónu."
			/>
		)
	}

	return (
		<div className="flex flex-col gap-4">
			<div>
				<Link to="/kalendar" className="text-ink-muted inline-flex items-center gap-1.5 text-sm">
					<ArrowLeftIcon className="size-4" />
					Kalendář
				</Link>
				<h1 className="mt-2 text-xl font-semibold tracking-tight">Nová akce</h1>
				<p className="text-ink-muted mt-1 text-sm">{season.name}</p>
			</div>

			<div className="bg-surface-2 flex gap-1 rounded-xl p-1" role="group" aria-label="Druh zadání">
				<Toggle active={!repeats} onClick={() => setRepeats(false)}>
					Jeden termín
				</Toggle>
				<Toggle active={repeats} onClick={() => setRepeats(true)}>
					Opakovaně
				</Toggle>
			</div>

			{repeats ? (
				<SeriesForm
					seasonId={seasonId}
					teamId={team?.id ?? null}
					clubId={team?.clubId ?? null}
					startsOn={season.startsOn}
					endsOn={season.endsOn}
				/>
			) : (
				<SingleForm
					seasonId={seasonId}
					teamId={team?.id ?? null}
					clubId={team?.clubId ?? null}
					startsOn={season.startsOn}
				/>
			)}
		</div>
	)
}

function Toggle({ active, onClick, children }: { active: boolean; onClick: () => void; children: string }) {
	return (
		<button
			type="button"
			onClick={onClick}
			aria-pressed={active}
			className={cn(
				'min-h-11 flex-1 rounded-lg px-3 text-sm transition-colors',
				active ? 'bg-surface-0 text-ink font-medium' : 'text-ink-muted',
			)}
		>
			{children}
		</button>
	)
}

interface FormProps {
	seasonId: number
	teamId: number | null
	clubId: number | null
	startsOn: string
	endsOn?: string
}

function SingleForm({ seasonId, teamId, clubId, startsOn }: FormProps) {
	const teamDetail = useTeamDetail(teamId)
	const events = useEvents(seasonId)
	const homeLocationId = teamDetail.data?.settings.homeLocationId ?? null
	const navigate = useNavigate()
	const create = useCreateEvent(seasonId)

	const [type, setType] = useState<EventType>('training')
	const [title, setTitle] = useState('')
	const [startsAt, setStartsAt] = useState(`${todayOrLater(startsOn)}T19:00`)
	const [durationMin, setDurationMin] = useState('90')
	const [meetBeforeMin, setMeetBeforeMin] = useState('')
	const [locationId, setLocationId] = useState<number | null>(null)
	const [opponent, setOpponent] = useState('')
	const [distanceKm, setDistanceKm] = useState('')
	const [travelLinkEventId, setTravelLinkEventId] = useState<number | null>(null)
	const [note, setNote] = useState('')
	const [rsvpDeadlineAt, setRsvpDeadlineAt] = useState('')

	const atHome = homeLocationId !== null && locationId === homeLocationId
	const inheritedDeadline =
		teamDetail.data === undefined ? null : inheritedDeadlineAt(startsAt, type, teamDetail.data.settings)

	async function submit(event: SubmitEvent<HTMLFormElement>) {
		event.preventDefault()

		const minutes = Number.parseInt(durationMin, 10)
		const meets = meetBeforeMin.trim() === '' ? null : Number.parseInt(meetBeforeMin, 10)
		const linked = type === 'match' && travelLinkEventId !== null

		const created = await create.mutateAsync({
			type,
			title: title.trim() === '' ? eventTypeLabels[type] : title.trim(),
			startsAt,
			endsAt: Number.isFinite(minutes) ? shiftMinutes(startsAt, minutes) : null,
			meetAt: meets === null || !Number.isFinite(meets) ? null : shiftMinutes(startsAt, -meets),
			locationId,
			opponent: type === 'match' && opponent.trim() !== '' ? opponent.trim() : null,
			distanceKm: type === 'match' && !linked && distanceKm.trim() !== '' ? Number.parseInt(distanceKm, 10) : null,
			travelLinkEventId: linked ? travelLinkEventId : null,
			note: note.trim() === '' ? null : note.trim(),
			rsvpDeadlineAt: rsvpDeadlineAt.trim() === '' ? null : rsvpDeadlineAt,
		})

		await navigate(`/akce/${created.id}`, { replace: true })
	}

	return (
		<form onSubmit={submit} noValidate className="flex flex-col gap-4">
			<Card>
				<CardHeader title="Kdy a co" />
				<div className="flex flex-col gap-4 p-4">
					<TypePicker value={type} onChange={setType} />

					<Field
						label="Název"
						value={title}
						onChange={(event) => setTitle(event.target.value)}
						placeholder={eventTypeLabels[type]}
						hint="Když necháte prázdné, použije se druh akce."
						maxLength={120}
					/>

					<Field
						label="Začátek"
						type="datetime-local"
						value={startsAt}
						onChange={(event) => setStartsAt(event.target.value)}
						required
					/>

					<Field
						label="Termín pro zápis"
						type="datetime-local"
						value={rsvpDeadlineAt}
						onChange={(event) => setRsvpDeadlineAt(event.target.value)}
						hint={
							rsvpDeadlineAt !== ''
								? 'Ruční termín platí jen pro tuhle akci.'
								: inheritedDeadline === null
									? 'Prázdné — pro tento druh akce se výchozí termín neřeší.'
									: `Prázdné — použije se výchozí termín ${formatDeadline(inheritedDeadline)}.`
						}
					/>

					<div className="grid grid-cols-2 gap-3">
						<Field
							label="Délka (min)"
							type="number"
							inputMode="numeric"
							min={15}
							max={720}
							value={durationMin}
							onChange={(event) => setDurationMin(event.target.value)}
						/>
						<Field
							label="Sraz předem (min)"
							type="number"
							inputMode="numeric"
							min={0}
							max={720}
							value={meetBeforeMin}
							onChange={(event) => setMeetBeforeMin(event.target.value)}
							placeholder="—"
						/>
					</div>
				</div>
			</Card>

			<LocationCard clubId={clubId} value={locationId} onChange={setLocationId} />

			{type === 'match' ? (
				<Card>
					<CardHeader
						title={atHome ? 'Domácí zápas' : 'Zápas venku'}
						subtitle={
							atHome
								? 'Hraje se v domácí hale, cestovní náhrada tu nevzniká.'
								: 'Vzdálenost je podklad pro cesťák — jednosměrná, od domácí haly k soupeři.'
						}
					/>
					<div className="flex flex-col gap-4 p-4">
						<Field label="Soupeř" value={opponent} onChange={(event) => setOpponent(event.target.value)} />
						<TravelLinkField
							events={events.data ?? []}
							excludeEventId={null}
							referenceStartsAt={startsAt}
							value={travelLinkEventId}
							onChange={setTravelLinkEventId}
						/>
						{/* U domácího zápasu by vzdálenost jen svedla k cesťáku za cestu do vlastní haly. */}
						{atHome || travelLinkEventId !== null ? null : (
							<Field
								label="Vzdálenost (km)"
								type="number"
								inputMode="numeric"
								min={0}
								max={2000}
								value={distanceKm}
								onChange={(event) => setDistanceKm(event.target.value)}
								placeholder="—"
								hint={
									homeLocationId === null
										? 'Domácí hala zatím není nastavená, takže doma a venku od sebe nerozeznáme.'
										: undefined
								}
							/>
						)}
					</div>
				</Card>
			) : null}

			<NoteField value={note} onChange={setNote} />

			<ErrorLine error={create.error} />

			<Button type="submit" variant="accent" size="lg" fullWidth loading={create.isPending}>
				Založit akci
			</Button>
		</form>
	)
}

function SeriesForm({ seasonId, clubId, startsOn, endsOn }: FormProps) {
	const navigate = useNavigate()
	const create = useCreateSeries(seasonId)

	const [type, setType] = useState<EventType>('training')
	const [title, setTitle] = useState('')
	const [days, setDays] = useState<Weekday[]>(['TU', 'TH'])
	const [interval, setInterval] = useState(1)
	const [startTime, setStartTime] = useState('19:00')
	const [durationMin, setDurationMin] = useState('90')
	const [meetBeforeMin, setMeetBeforeMin] = useState('')
	const [locationId, setLocationId] = useState<number | null>(null)
	const [activeFrom, setActiveFrom] = useState(todayOrLater(startsOn))
	const [activeTo, setActiveTo] = useState(endsOn ?? startsOn)
	const [note, setNote] = useState('')

	const rrule = buildRrule(days, interval)

	async function submit(event: SubmitEvent<HTMLFormElement>) {
		event.preventDefault()

		const meets = meetBeforeMin.trim() === '' ? null : Number.parseInt(meetBeforeMin, 10)

		await create.mutateAsync({
			title: title.trim() === '' ? eventTypeLabels[type] : title.trim(),
			type,
			rrule,
			startTime,
			durationMin: Number.parseInt(durationMin, 10),
			locationId,
			meetBeforeMin: meets === null || !Number.isFinite(meets) ? null : meets,
			defaultNote: note.trim() === '' ? null : note.trim(),
			activeFrom,
			activeTo,
		})

		await navigate('/kalendar', { replace: true })
	}

	return (
		<form onSubmit={submit} noValidate className="flex flex-col gap-4">
			<Card>
				<CardHeader
					title="Opakování"
					subtitle="Termíny se vyrobí hned všechny — odpovědi se váží na konkrétní datum, ne na pravidlo."
				/>
				<div className="flex flex-col gap-4 p-4">
					<TypePicker value={type} onChange={setType} />

					<Field
						label="Název"
						value={title}
						onChange={(event) => setTitle(event.target.value)}
						placeholder={eventTypeLabels[type]}
						maxLength={120}
					/>

					<fieldset className="flex flex-col gap-1.5">
						<legend className="text-ink-muted text-sm font-medium">Dny v týdnu</legend>
						<div className="mt-1 flex gap-1.5">
							{weekdays.map((day) => (
								<button
									key={day}
									type="button"
									aria-pressed={days.includes(day)}
									onClick={() => setDays(toggle(days, day))}
									className={cn(
										'min-h-11 flex-1 rounded-xl text-sm transition-colors',
										days.includes(day) ? 'bg-brand-600 font-semibold text-white' : 'bg-surface-2 text-ink-muted',
									)}
								>
									{weekdayLabels[day]}
								</button>
							))}
						</div>
						<p className="text-ink-faint mt-1 text-xs">{describeRrule(rrule, startTime)}</p>
					</fieldset>

					<div className="grid grid-cols-2 gap-3">
						<Field
							label="Začátek"
							type="time"
							value={startTime}
							onChange={(event) => setStartTime(event.target.value)}
							required
						/>
						<label className="flex flex-col gap-1.5">
							<span className="text-ink-muted text-sm font-medium">Jak často</span>
							<Select value={interval} onChange={(event) => setInterval(Number.parseInt(event.target.value, 10))}>
								<option value={1}>Každý týden</option>
								<option value={2}>Každý druhý týden</option>
							</Select>
						</label>
					</div>

					<div className="grid grid-cols-2 gap-3">
						<Field
							label="Délka (min)"
							type="number"
							inputMode="numeric"
							min={15}
							max={720}
							value={durationMin}
							onChange={(event) => setDurationMin(event.target.value)}
						/>
						<Field
							label="Sraz předem (min)"
							type="number"
							inputMode="numeric"
							min={0}
							max={720}
							value={meetBeforeMin}
							onChange={(event) => setMeetBeforeMin(event.target.value)}
							placeholder="—"
						/>
					</div>

					<div className="grid grid-cols-2 gap-3">
						<Field
							label="Od"
							type="date"
							value={activeFrom}
							onChange={(event) => setActiveFrom(event.target.value)}
							required
						/>
						<Field
							label="Do"
							type="date"
							value={activeTo}
							onChange={(event) => setActiveTo(event.target.value)}
							hint="Ořízne se sezónou."
							required
						/>
					</div>
				</div>
			</Card>

			<LocationCard clubId={clubId} value={locationId} onChange={setLocationId} />

			<NoteField value={note} onChange={setNote} />

			<ErrorLine error={create.error} />

			<Button type="submit" variant="accent" size="lg" fullWidth loading={create.isPending} disabled={rrule === ''}>
				Vyrobit termíny
			</Button>
		</form>
	)
}

function TypePicker({ value, onChange }: { value: EventType; onChange: (value: EventType) => void }) {
	return (
		<fieldset className="flex flex-col gap-1.5">
			<legend className="text-ink-muted text-sm font-medium">Druh</legend>
			<div className="bg-surface-2 mt-1 flex gap-1 rounded-xl p-1">
				{eventTypes.map((type) => (
					<button
						key={type}
						type="button"
						aria-pressed={value === type}
						onClick={() => onChange(type)}
						className={cn(
							'min-h-11 flex-1 rounded-lg px-2 text-sm transition-colors',
							value === type ? 'bg-surface-0 text-ink font-medium' : 'text-ink-muted',
						)}
					>
						{eventTypeLabels[type]}
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
		if (clubId === null || name.trim() === '') {
			return
		}

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
				<Select
					value={value ?? ''}
					onChange={(event) => onChange(event.target.value === '' ? null : Number.parseInt(event.target.value, 10))}
					aria-label="Místo konání"
				>
					<option value="">Neurčeno</option>
					{(locations.data ?? []).map((location) => (
						<option key={location.id} value={location.id}>
							{location.name}
						</option>
					))}
				</Select>

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
	if (error === null || error === undefined) {
		return null
	}

	return (
		<p role="alert" className="bg-debt-500/15 text-debt rounded-xl px-3 py-2 text-sm">
			{error instanceof ApiError ? error.message : 'Uložení se nepodařilo.'}
		</p>
	)
}

function toggle(days: Weekday[], day: Weekday): Weekday[] {
	return days.includes(day) ? days.filter((item) => item !== day) : [...days, day]
}
