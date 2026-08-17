import type { SubmitEvent } from 'react'
import { useId, useState } from 'react'
import { Link } from 'react-router'

import { useTeam } from '@/app/team'
import { NoSeasonState } from '@/components/NoSeasonState'
import { Button } from '@/components/ui/Button'
import { Card, CardHeader } from '@/components/ui/Card'
import { ConfirmDialog } from '@/components/ui/ConfirmDialog'
import { Field } from '@/components/ui/Field'
import { ArrowLeftIcon } from '@/components/ui/icons'
import { Select } from '@/components/ui/Select'
import { EmptyState, ErrorState, LoadingState } from '@/components/ui/States'
import type { Weekday } from '@/features/events/events'
import {
	buildRrule,
	describeRrule,
	formatEventTime,
	parseRrule,
	weekdayLabels,
	weekdays,
} from '@/features/events/events'
import { ApiError } from '@/lib/api'
import { cn } from '@/lib/cn'
import { plural } from '@/lib/plural'
import type { SeriesChangeResult, SeriesScope } from '@/lib/queries'
import { useDeleteSeries, useEventSeries, useEvents, useLocations, useUpdateSeries } from '@/lib/queries'
import type { EventSeries, EventType, TeamEvent } from '@/lib/types'
import { eventTypeLabels, eventTypes, formatDate } from '@/lib/types'

/** Úprava a mazání celé série s volbou rozsahu (`following`/`all`); založení nové série je na `NewEventPage`. */
export function SeriesPage() {
	const { team, season, seasonId, can, isSeasonClosed } = useTeam()

	if (seasonId === null || season === null) return <NoSeasonState what="opakované akce" />

	if (!can('treasurer')) {
		return (
			<EmptyState
				title="Opakované akce spravuje pínař nebo admin"
				description="Kdo tuhle roli má, uvidíte na obrazovce družstva."
			/>
		)
	}

	if (isSeasonClosed) {
		return (
			<EmptyState
				title="Sezóna je uzavřená"
				description="V uzavřené sezóně se série neupravují ani nemažou. Přepněte se na otevřenou sezónu."
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
				<h1 className="mt-2 text-xl font-semibold tracking-tight">Opakované akce</h1>
				<p className="text-ink-muted mt-1 text-sm">{season.name}</p>
			</div>

			<SeriesList seasonId={seasonId} clubId={team?.clubId ?? null} />
		</div>
	)
}

function SeriesList({ seasonId, clubId }: { seasonId: number; clubId: number | null }) {
	const seriesQuery = useEventSeries(seasonId)
	const eventsQuery = useEvents(seasonId)
	const [deleteMessage, setDeleteMessage] = useState<string | null>(null)

	if (seriesQuery.isPending || eventsQuery.isPending) return <LoadingState />
	if (seriesQuery.error !== null) {
		return <ErrorState error={seriesQuery.error} onRetry={() => void seriesQuery.refetch()} />
	}
	if (eventsQuery.error !== null) {
		return <ErrorState error={eventsQuery.error} onRetry={() => void eventsQuery.refetch()} />
	}

	if (seriesQuery.data.length === 0) {
		return (
			<EmptyState
				title="Žádná opakovaná akce"
				description="Opakovanou akci založíte na obrazovce nové akce."
				action={
					<Link
						to="/akce/nova"
						role="button"
						className="bg-accent text-on-accent mt-1 inline-flex min-h-11 items-center rounded-xl px-4 text-sm font-semibold"
					>
						Nová akce
					</Link>
				}
			/>
		)
	}

	return (
		<div className="flex flex-col gap-3">
			{deleteMessage === null ? null : (
				<p role="status" className="bg-surface-2 text-ink rounded-xl px-3 py-2 text-sm">
					{deleteMessage}
				</p>
			)}

			{seriesQuery.data.map((series) => (
				<SeriesCard
					key={series.id}
					seasonId={seasonId}
					clubId={clubId}
					series={series}
					// Jen budoucí termíny — u proběhlých nedává „od teď dál" smysl.
					futureEvents={eventsQuery.data.filter((event) => event.seriesId === series.id && !event.started)}
					onDeleted={setDeleteMessage}
				/>
			))}
		</div>
	)
}

interface SeriesCardProps {
	seasonId: number
	clubId: number | null
	series: EventSeries
	futureEvents: TeamEvent[]
	onDeleted: (message: string) => void
}

function SeriesCard({ seasonId, clubId, series, futureEvents, onDeleted }: SeriesCardProps) {
	const [mode, setMode] = useState<'view' | 'edit' | 'delete'>('view')
	const [updateMessage, setUpdateMessage] = useState<string | null>(null)

	return (
		<Card>
			<CardHeader
				title={series.title}
				subtitle={`${eventTypeLabels[series.type]} · ${describeRrule(series.rrule, series.startTime)}`}
				action={
					<div className="flex gap-2">
						<Button
							size="sm"
							variant="ghost"
							onClick={() => {
								setUpdateMessage(null)
								setMode(mode === 'edit' ? 'view' : 'edit')
							}}
						>
							Upravit
						</Button>
						<Button size="sm" variant="ghost" onClick={() => setMode(mode === 'delete' ? 'view' : 'delete')}>
							Smazat
						</Button>
					</div>
				}
			/>

			<div className="text-ink-muted flex flex-col gap-1 p-4 text-sm">
				<p>{series.location?.name ?? 'Místo neurčeno'}</p>
				<p>
					{formatDate(series.activeFrom)} – {formatDate(series.activeTo)}
				</p>
				<p>{plural(series.eventCount, 'termín', 'termíny', 'termínů')}</p>
			</div>

			{updateMessage === null ? null : (
				<p role="status" className="bg-surface-2 text-ink mx-4 mb-4 rounded-xl px-3 py-2 text-sm">
					{updateMessage}
				</p>
			)}

			{mode === 'edit' ? (
				<SeriesEditForm
					seasonId={seasonId}
					clubId={clubId}
					series={series}
					futureEvents={futureEvents}
					onSuccess={(result) => {
						setMode('view')
						setUpdateMessage(describeSeriesChange(result))
					}}
					onCancel={() => setMode('view')}
				/>
			) : null}

			{mode === 'delete' ? (
				<SeriesDeleteSection
					seasonId={seasonId}
					series={series}
					futureEvents={futureEvents}
					onDeleted={(message) => {
						setMode('view')
						onDeleted(message)
					}}
					onCancel={() => setMode('view')}
				/>
			) : null}
		</Card>
	)
}

interface SeriesEditFormProps {
	seasonId: number
	clubId: number | null
	series: EventSeries
	futureEvents: TeamEvent[]
	onSuccess: (result: SeriesChangeResult) => void
	onCancel: () => void
}

function SeriesEditForm({ seasonId, clubId, series, futureEvents, onSuccess, onCancel }: SeriesEditFormProps) {
	const updateSeries = useUpdateSeries(seasonId)
	const locations = useLocations(clubId)
	const parsedRrule = parseRrule(series.rrule)

	const [type, setType] = useState<EventType>(series.type)
	const [title, setTitle] = useState(series.title)
	const [days, setDays] = useState<Weekday[]>(parsedRrule.days)
	const [interval, setInterval] = useState(parsedRrule.interval)
	const [startTime, setStartTime] = useState(series.startTime)
	const [durationMin, setDurationMin] = useState(String(series.durationMin))
	const [meetBeforeMin, setMeetBeforeMin] = useState(series.meetBeforeMin === null ? '' : String(series.meetBeforeMin))
	const [locationId, setLocationId] = useState<number | null>(series.location?.id ?? null)
	const [note, setNote] = useState(series.defaultNote ?? '')
	const [activeTo, setActiveTo] = useState(series.activeTo)

	const [scope, setScope] = useState<SeriesScope>(futureEvents.length > 0 ? 'following' : 'all')
	const [fromEventId, setFromEventId] = useState<number | null>(futureEvents[0]?.id ?? null)

	const rrule = buildRrule(days, interval)

	async function submit(event: SubmitEvent<HTMLFormElement>) {
		event.preventDefault()

		const meets = meetBeforeMin.trim() === '' ? null : Number.parseInt(meetBeforeMin, 10)

		const base = {
			seriesId: series.id,
			scope,
			title: title.trim() === '' ? eventTypeLabels[type] : title.trim(),
			type,
			rrule,
			startTime,
			durationMin: Number.parseInt(durationMin, 10),
			locationId,
			meetBeforeMin: meets === null || !Number.isFinite(meets) ? null : meets,
			defaultNote: note.trim() === '' ? null : note.trim(),
			// Server zajímá jen konec období — začátek série se zpětně neposouvá.
			activeFrom: series.activeFrom,
			activeTo,
		}

		const result = await updateSeries.mutateAsync(
			scope === 'following' && fromEventId !== null ? { ...base, fromEventId } : base,
		)

		onSuccess(result)
	}

	return (
		<form onSubmit={submit} noValidate className="border-line/60 flex flex-col gap-4 border-t p-4">
			<TypePicker value={type} onChange={setType} />

			<Field label="Název" value={title} onChange={(event) => setTitle(event.target.value)} maxLength={120} />

			<fieldset className="flex flex-col gap-1.5">
				<legend className="text-ink-muted text-sm font-medium">Dny v týdnu</legend>
				<div className="mt-1 flex gap-1.5">
					{weekdays.map((day) => (
						<button
							key={day}
							type="button"
							aria-pressed={days.includes(day)}
							onClick={() => setDays(toggleDay(days, day))}
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

			<label className="flex flex-col gap-1.5">
				<span className="text-ink-muted text-sm font-medium">Místo</span>
				<Select
					value={locationId ?? ''}
					onChange={(event) =>
						setLocationId(event.target.value === '' ? null : Number.parseInt(event.target.value, 10))
					}
				>
					<option value="">Neurčeno</option>
					{(locations.data ?? []).map((location) => (
						<option key={location.id} value={location.id}>
							{location.name}
						</option>
					))}
				</Select>
			</label>

			<Field
				label="Konec období"
				type="date"
				value={activeTo}
				onChange={(event) => setActiveTo(event.target.value)}
				hint="Ořízne se sezónou."
				required
			/>

			<label className="flex flex-col gap-1.5">
				<span className="text-ink-muted text-sm font-medium">Poznámka</span>
				<textarea
					value={note}
					onChange={(event) => setNote(event.target.value)}
					rows={3}
					className="border-line bg-surface-2 text-ink placeholder:text-ink-faint w-full rounded-xl border px-3 py-2.5 text-base"
					placeholder="Vezměte si tmavé dresy."
				/>
			</label>

			<ScopePicker
				scope={scope}
				onScopeChange={setScope}
				fromEventId={fromEventId}
				onFromEventIdChange={setFromEventId}
				futureEvents={futureEvents}
			/>

			<ErrorLine error={updateSeries.error} />

			<div className="flex gap-2">
				<Button type="submit" variant="accent" fullWidth loading={updateSeries.isPending} disabled={rrule === ''}>
					Uložit
				</Button>
				<Button type="button" variant="ghost" onClick={onCancel}>
					Zrušit
				</Button>
			</div>
		</form>
	)
}

interface SeriesDeleteSectionProps {
	seasonId: number
	series: EventSeries
	futureEvents: TeamEvent[]
	onDeleted: (message: string) => void
	onCancel: () => void
}

function SeriesDeleteSection({ seasonId, series, futureEvents, onDeleted, onCancel }: SeriesDeleteSectionProps) {
	const deleteSeries = useDeleteSeries(seasonId)
	const [scope, setScope] = useState<SeriesScope>(futureEvents.length > 0 ? 'following' : 'all')
	const [fromEventId, setFromEventId] = useState<number | null>(futureEvents[0]?.id ?? null)
	const [confirming, setConfirming] = useState(false)

	async function handleConfirm() {
		setConfirming(false)

		const result = await deleteSeries.mutateAsync(
			scope === 'following' && fromEventId !== null
				? { seriesId: series.id, scope, fromEventId }
				: { seriesId: series.id, scope },
		)

		onDeleted(describeSeriesDeletion(result))
	}

	// Řekni pravdu: mizí i odpovědi a docházka, u „celé série" i to, co už proběhlo.
	const description =
		scope === 'following'
			? 'Zmizí tenhle a všechny další termíny série i s odpověďmi hráčů a docházkou. Zapsané prohřešky zůstanou, jen ztratí vazbu na akci.'
			: 'Zmizí úplně všechny termíny série, i ty, co už proběhly, i s odpověďmi hráčů a docházkou. Zapsané prohřešky zůstanou, jen ztratí vazbu na akci.'

	return (
		<div className="border-line/60 flex flex-col gap-4 border-t p-4">
			<ScopePicker
				scope={scope}
				onScopeChange={setScope}
				fromEventId={fromEventId}
				onFromEventIdChange={setFromEventId}
				futureEvents={futureEvents}
			/>

			<ErrorLine error={deleteSeries.error} />

			<div className="flex gap-2">
				<Button variant="danger" fullWidth loading={deleteSeries.isPending} onClick={() => setConfirming(true)}>
					Smazat
				</Button>
				<Button variant="ghost" onClick={onCancel}>
					Zrušit
				</Button>
			</div>

			<ConfirmDialog
				open={confirming}
				title="Smazat sérii?"
				description={description}
				confirmLabel="Smazat"
				danger
				onConfirm={() => void handleConfirm()}
				onCancel={() => setConfirming(false)}
			/>
		</div>
	)
}

interface ScopePickerProps {
	scope: SeriesScope
	onScopeChange: (scope: SeriesScope) => void
	fromEventId: number | null
	onFromEventIdChange: (id: number) => void
	futureEvents: TeamEvent[]
}

/** Radia mají `useId()` jako název skupiny — víc otevřených karet najednou se nesmí přepínat navzájem. */
function ScopePicker({ scope, onScopeChange, fromEventId, onFromEventIdChange, futureEvents }: ScopePickerProps) {
	const groupName = useId()
	const hasFuture = futureEvents.length > 0

	return (
		<fieldset className="border-line flex flex-col gap-2 rounded-xl border p-3">
			<legend className="text-ink-muted px-1 text-sm font-medium">Rozsah změny</legend>

			<label className={cn('flex min-h-11 items-center gap-3', hasFuture ? 'cursor-pointer' : 'text-ink-faint')}>
				<input
					type="radio"
					name={groupName}
					className="size-5 shrink-0"
					checked={scope === 'following'}
					disabled={!hasFuture}
					onChange={() => onScopeChange('following')}
				/>
				<span className="text-sm">Od teď dál — tenhle termín a všechny další</span>
			</label>

			{scope === 'following' && hasFuture ? (
				<Select
					value={fromEventId ?? ''}
					onChange={(event) => onFromEventIdChange(Number.parseInt(event.target.value, 10))}
					wrapperClassName="ml-8"
					aria-label="Od kterého termínu"
				>
					{futureEvents.map((futureEvent) => (
						<option key={futureEvent.id} value={futureEvent.id}>
							{formatEventTime(futureEvent.startsAt)}
						</option>
					))}
				</Select>
			) : null}

			<label className="flex min-h-11 cursor-pointer items-center gap-3">
				<input
					type="radio"
					name={groupName}
					className="size-5 shrink-0"
					checked={scope === 'all'}
					onChange={() => onScopeChange('all')}
				/>
				<span className="text-sm">Celá série — i termíny, které už proběhly</span>
			</label>
		</fieldset>
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

/** Hláška ze serveru je konkrétnější než cokoli, co bychom vymysleli tady. */
function ErrorLine({ error }: { error: unknown }) {
	if (error === null || error === undefined) return null

	return (
		<p role="alert" className="bg-debt-500/15 text-debt rounded-xl px-3 py-2 text-sm">
			{error instanceof ApiError ? error.message : 'Uložení se nepodařilo.'}
		</p>
	)
}

/** „Upraveno 12 termínů, 3 přibyly, 2 se smazaly, 1 zůstal beze změny (ručně upravený)." — nulové části se vynechají. */
function describeSeriesChange(result: SeriesChangeResult): string {
	const parts: string[] = []

	if (result.updated > 0) parts.push(`Upraveno ${plural(result.updated, 'termín', 'termíny', 'termínů')}`)
	if (result.created > 0) parts.push(plural(result.created, 'přibyl', 'přibyly', 'přibylo'))
	if (result.deleted > 0) parts.push(plural(result.deleted, 'se smazal', 'se smazaly', 'se smazalo'))
	if (result.skipped > 0) {
		parts.push(
			plural(
				result.skipped,
				'zůstal beze změny (ručně upravený)',
				'zůstaly beze změny (ručně upravené)',
				'zůstalo beze změny (ručně upravených)',
			),
		)
	}

	return parts.length === 0 ? 'Beze změny.' : `${parts.join(', ')}.`
}

function describeSeriesDeletion(result: { deleted: number; kept: number }): string {
	const parts = [`Smazáno ${plural(result.deleted, 'termín', 'termíny', 'termínů')}`]

	if (result.kept > 0) parts.push(`${plural(result.kept, 'zůstal', 'zůstaly', 'zůstalo')} beze změny`)

	return `${parts.join(', ')}.`
}

function toggleDay(days: Weekday[], day: Weekday): Weekday[] {
	return days.includes(day) ? days.filter((item) => item !== day) : [...days, day]
}
