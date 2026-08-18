import { useState } from 'react'
import { Link } from 'react-router'

import { useTeam } from '@/app/team'
import { NoSeasonState } from '@/components/NoSeasonState'
import { Card, CardHeader } from '@/components/ui/Card'
import { CalendarIcon, ChevronRightIcon, MapPinIcon, PlusIcon } from '@/components/ui/icons'
import { EmptyState, ErrorState, LoadingState } from '@/components/ui/States'
import { canAnswer, formatEventTime, groupByMonth, nextEvent, rsvpSummary } from '@/features/events/events'
import type { EventMonth } from '@/features/events/events'
import { EventsNav } from '@/features/events/EventsNav'
import { EventTypeBadge } from '@/features/events/EventTypeMark'
import { MonthGrid } from '@/features/events/MonthGrid'
import { RsvpButtons } from '@/features/events/RsvpButtons'
import { ApiError } from '@/lib/api'
import { cn } from '@/lib/cn'
import { useEvents, useSaveRsvp } from '@/lib/queries'
import { attendanceLabels } from '@/lib/types'
import type { EventType, Rsvp, TeamEvent } from '@/lib/types'

const stripeClass: Record<EventType, string> = {
	training: 'bg-event-training',
	match: 'bg-event-match',
	other: 'bg-event-other',
}

export function CalendarPage() {
	const { seasonId, isSeasonClosed, can } = useTeam()
	const { data, isPending, error, refetch } = useEvents(seasonId)
	const [view, setView] = useState<View>(storedView)
	const [month, setMonth] = useState<string | null>(null)
	const [period, setPeriod] = useState<Period>('upcoming')

	if (seasonId === null) return <NoSeasonState what="akce" />

	if (isPending) return <LoadingState />
	if (error !== null) return <ErrorState error={error} onRetry={() => void refetch()} />

	const events = data ?? []
	// Zakládat akce smí pínař — kalendář je provoz družstva, ne správa účtů.
	const canPlan = can('treasurer')
	const highlighted = nextEvent(events)

	// Zvýrazněná nejbližší akce se v seznamu níž neopakuje.
	const futureEvents = events.filter((event) => !event.started && event.id !== highlighted?.id)
	// Proběhlé od nejnovější — se sezónou do června jich jsou desítky a hledá se hlavně ten poslední trénink.
	const pastEvents = events.filter((event) => event.started).toReversed()
	const listedMonths = groupByMonth(period === 'upcoming' ? futureEvents : pastEvents)

	// Mřížka startuje u nejbližší akce, ne u ledna — kdo ji otevře, chce vidět teď.
	const shownMonth = month ?? (highlighted ?? events.at(-1))?.startsAt.slice(0, 7) ?? currentMonth()

	return (
		<div className="flex flex-col gap-4">
			{/* Dva řádky: na šířku telefonu se vše do jedné řady nevejde a „Nová akce" se lámala. */}
			<div className="flex items-center justify-between gap-3">
				<EventsNav />
				{canPlan ? (
					<Link
						to="/akce/nova"
						role="button"
						className="bg-accent text-on-accent inline-flex min-h-11 shrink-0 items-center gap-1.5 rounded-xl px-4 text-sm font-semibold whitespace-nowrap"
					>
						<PlusIcon className="size-4" />
						Nová akce
					</Link>
				) : null}
			</div>

			{isSeasonClosed ? (
				<p className="bg-surface-2 text-ink-muted rounded-xl px-4 py-3 text-sm">
					Sezóna je uzavřená — na akce se nedá odpovídat ani zakládat nové.
				</p>
			) : null}

			<ViewSwitch value={view} onChange={(next) => setView(rememberView(next))} />

			{events.length === 0 ? (
				<EmptyState
					title={canPlan ? 'Zatím žádné akce' : 'Zatím nic naplánované'}
					description={
						canPlan
							? 'Založte první trénink nebo zápas sezóny.'
							: 'Jakmile pínař nebo admin naplánuje akci, objeví se tady.'
					}
					action={
						canPlan ? (
							<Link
								to="/akce/nova"
								role="button"
								className="bg-accent text-on-accent mt-1 inline-flex min-h-11 items-center rounded-xl px-4 text-sm font-semibold"
							>
								Založit akci
							</Link>
						) : undefined
					}
				/>
			) : (
				<>
					{highlighted === null ? null : (
						<div className="flex flex-col gap-2">
							<h2 className="text-lg font-semibold">Nejbližší akce</h2>
							<NextEventCard event={highlighted} seasonId={seasonId} disabled={isSeasonClosed} />
						</div>
					)}

					{view === 'grid' ? (
						<MonthGrid month={shownMonth} events={events} onMonthChange={setMonth} />
					) : (
						<>
							<PeriodSwitch value={period} onChange={setPeriod} past={pastEvents.length} />

							{listedMonths.length === 0 ? (
								<p className="text-ink-muted px-1 py-6 text-center text-sm">
									{period === 'upcoming' ? 'Další akce zatím naplánovaná není.' : 'Zatím nic neproběhlo.'}
								</p>
							) : (
								<div className="flex flex-col gap-4">
									{listedMonths.map((group) => (
										<MonthSection key={group.key} month={group} />
									))}
								</div>
							)}

							{period === 'past' ? (
								<p className="text-ink-faint px-1 text-xs">
									Od nejnovější. Konkrétní datum se hledá snáz v měsíčním pohledu.
								</p>
							) : null}
						</>
					)}
				</>
			)}
		</div>
	)
}

type View = 'list' | 'grid'

const VIEW_KEY = 'pina.calendarView'

/** Volba pohledu přežije zavření prohlížeče; v Safari v privátním režimu ne, a to nevadí. */
function storedView(): View {
	try {
		return localStorage.getItem(VIEW_KEY) === 'grid' ? 'grid' : 'list'
	} catch {
		return 'list'
	}
}

function rememberView(view: View): View {
	try {
		localStorage.setItem(VIEW_KEY, view)
	} catch {
		// Neuložilo se — volba platí do konce relace.
	}

	return view
}

function currentMonth(): string {
	const now = new Date()

	return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`
}

/** Nadcházející, nebo proběhlé. Výchozí je „co bude" — kvůli tomu se kalendář otevírá. */
type Period = 'upcoming' | 'past'

function PeriodSwitch({ value, onChange, past }: { value: Period; onChange: (period: Period) => void; past: number }) {
	return (
		<div className="border-line/60 flex gap-4 border-b" role="group" aria-label="Které akce">
			<PeriodTab active={value === 'upcoming'} onClick={() => onChange('upcoming')}>
				Nadcházející
			</PeriodTab>
			<PeriodTab active={value === 'past'} onClick={() => onChange('past')}>
				{past === 0 ? 'Proběhlé' : `Proběhlé (${past})`}
			</PeriodTab>
		</div>
	)
}

function PeriodTab({ active, onClick, children }: { active: boolean; onClick: () => void; children: string }) {
	return (
		<button
			type="button"
			onClick={onClick}
			aria-pressed={active}
			className={cn(
				'-mb-px min-h-11 border-b-2 px-1 text-sm transition-colors',
				active ? 'border-accent text-ink font-medium' : 'text-ink-muted border-transparent',
			)}
		>
			{children}
		</button>
	)
}

function ViewSwitch({ value, onChange }: { value: View; onChange: (view: View) => void }) {
	return (
		<div className="bg-surface-2 flex rounded-xl p-1" role="group" aria-label="Pohled na kalendář">
			<button
				type="button"
				aria-pressed={value === 'list'}
				onClick={() => onChange('list')}
				className={cn(
					'min-h-11 rounded-lg px-3 text-sm transition-colors',
					value === 'list' ? 'bg-surface-0 text-ink font-medium' : 'text-ink-muted',
				)}
			>
				Seznam
			</button>
			<button
				type="button"
				aria-pressed={value === 'grid'}
				onClick={() => onChange('grid')}
				className={cn(
					'min-h-11 rounded-lg px-3 text-sm transition-colors',
					value === 'grid' ? 'bg-surface-0 text-ink font-medium' : 'text-ink-muted',
				)}
			>
				Měsíc
			</button>
		</div>
	)
}

function MonthSection({ month }: { month: EventMonth }) {
	return (
		<div>
			<div
				className="bg-surface-0/95 text-ink-muted sticky z-10 px-1 py-1.5 text-xs font-semibold tracking-wide uppercase backdrop-blur"
				style={{ top: 'calc(3.25rem + env(safe-area-inset-top))' }}
			>
				{month.label}
			</div>
			<Card className="divide-line/60 divide-y overflow-hidden">
				{month.events.map((event) => (
					<EventRow key={event.id} event={event} />
				))}
			</Card>
		</div>
	)
}

function EventRow({ event }: { event: TeamEvent }) {
	const cancelled = event.status === 'cancelled'

	return (
		<Link
			to={`/akce/${event.id}`}
			className={
				cancelled
					? 'flex items-center gap-3 px-4 py-3 opacity-60'
					: 'hover:bg-surface-2 flex items-center gap-3 px-4 py-3 transition-colors first:rounded-t-2xl last:rounded-b-2xl'
			}
		>
			{/* Barevný pruh nese typ akce, štítek vedle času ho pojmenuje. */}
			<span aria-hidden className={cn('-ml-2 h-10 w-1 shrink-0 rounded-full', stripeClass[event.type])} />

			<div className="min-w-0 flex-1">
				<div className="flex flex-wrap items-center gap-2">
					<p className="text-ink-muted tabular text-xs">{formatEventTime(event.startsAt)}</p>
					<EventTypeBadge type={event.type} />
					{cancelled ? (
						<span className="bg-debt-500/10 text-debt rounded-full px-2 py-0.5 text-xs font-medium">Zrušeno</span>
					) : null}
				</div>
				<p className="truncate font-medium">
					{event.title}
					{event.type === 'match' && event.opponent !== null ? (
						<span className="text-ink-muted font-normal"> · {event.opponent}</span>
					) : null}
				</p>
				<div className="text-ink-faint flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs">
					{event.location === null ? null : (
						<span className="inline-flex items-center gap-1">
							<MapPinIcon className="size-3.5" />
							{event.location.name}
						</span>
					)}
					{cancelled ? null : <span>{rowStatusText(event)}</span>}
				</div>
			</div>
			<ChevronRightIcon className="text-ink-faint size-4 shrink-0" />
		</Link>
	)
}

/** Proběhlá akce ukazuje mou docházku, budoucí souhrn odpovědí celého týmu. */
function rowStatusText(event: TeamEvent): string {
	if (event.started) {
		const attendance = event.me?.attendance ?? null

		return attendance === null ? 'Bez záznamu docházky' : attendanceLabels[attendance]
	}

	return rsvpSummary(event.counts)
}

function NextEventCard({ event, seasonId, disabled }: { event: TeamEvent; seasonId: number; disabled: boolean }) {
	const saveRsvp = useSaveRsvp(event.id, seasonId)
	const [pending, setPending] = useState<Rsvp | null>(null)
	const [error, setError] = useState<string | null>(null)

	const canRespond = canAnswer(event) && !disabled
	const currentRsvp = event.me?.rsvp ?? 'unknown'

	async function respond(rsvp: Rsvp) {
		if (event.me === null) return

		setError(null)
		setPending(rsvp)

		try {
			await saveRsvp.mutateAsync({ rsvp, transport: event.me.transport, carSeats: event.me.carSeats })
		} catch (cause) {
			setError(cause instanceof ApiError ? cause.message : 'Odpověď se nepodařilo uložit.')
		} finally {
			setPending(null)
		}
	}

	return (
		<Card className="overflow-hidden">
			<CardHeader
				title={
					<Link to={`/akce/${event.id}`} className="hover:underline">
						{event.title}
						{event.type === 'match' && event.opponent !== null ? ` · ${event.opponent}` : ''}
					</Link>
				}
				subtitle={
					<span className="inline-flex items-center gap-1.5">
						<CalendarIcon className="size-3.5" />
						{formatEventTime(event.startsAt)}
					</span>
				}
			/>

			<div className="flex flex-col gap-3 px-4 py-4">
				{event.location === null ? null : (
					<p className="text-ink-muted flex items-center gap-1.5 text-sm">
						<MapPinIcon className="size-4 shrink-0" />
						{event.location.name}
					</p>
				)}

				<p className="text-ink-faint text-sm">{rsvpSummary(event.counts)}</p>

				{canRespond ? (
					<RsvpButtons value={currentRsvp} onChange={(rsvp) => void respond(rsvp)} pending={pending} />
				) : disabled ? (
					<p className="text-ink-faint text-sm">Sezóna je uzavřená, odpověď se tu nedá měnit.</p>
				) : null}

				{error === null ? null : <p className="text-debt text-sm">{error}</p>}
			</div>
		</Card>
	)
}
