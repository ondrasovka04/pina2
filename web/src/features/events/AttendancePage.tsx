import { useState } from 'react'

import { useTeam } from '@/app/team'
import { NoSeasonState } from '@/components/NoSeasonState'
import { Avatar } from '@/components/ui/Avatar'
import { Card, CardHeader } from '@/components/ui/Card'
import { EmptyState, ErrorState, LoadingState } from '@/components/ui/States'
import { formatRatio } from '@/features/events/events'
import { EventsNav } from '@/features/events/EventsNav'
import { cn } from '@/lib/cn'
import { useAttendanceSummary } from '@/lib/queries'
import type { AttendanceRow, EventType } from '@/lib/types'

/** Účast za sezónu. Server vrátí adminovi celé družstvo, ostatním jen jejich řádek — na rozdíl od dluhů má být docházka soukromá. */
export function AttendancePage() {
	const { seasonId, season } = useTeam()
	const [type, setType] = useState<EventType | 'all'>('all')

	const summary = useAttendanceSummary(seasonId, type === 'all' ? undefined : type)

	if (seasonId === null) return <NoSeasonState what="docházku" />
	if (summary.isPending) return <LoadingState />
	if (summary.error !== null) return <ErrorState error={summary.error} onRetry={() => void summary.refetch()} />

	const rows = summary.data
	const alone = rows.length === 1

	return (
		<div className="flex flex-col gap-4">
			<div>
				<EventsNav />
				<p className="text-ink-muted mt-1 text-sm">
					{season?.name ?? 'Sezóna'} — počítá se z proběhlých akcí. Zranění se do procent nezapočítává.
				</p>
			</div>

			<TypeFilter value={type} onChange={setType} />

			{rows.length === 0 ? (
				<EmptyState
					title="Zatím není z čeho počítat"
					description="Účast se objeví, jakmile proběhne první trénink nebo zápas."
				/>
			) : (
				<Card>
					<CardHeader title={alone ? 'Moje účast' : 'Družstvo'} subtitle={alone ? undefined : `${rows.length} hráčů`} />
					<ul className="divide-line/60 divide-y">
						{rows.toSorted(byRatio).map((row) => (
							<AttendanceLine key={row.membershipId} row={row} />
						))}
					</ul>
				</Card>
			)}
		</div>
	)
}

/** Nejvyšší účast nahoru; kdo nemá z čeho počítat, patří dolů. */
function byRatio(a: AttendanceRow, b: AttendanceRow): number {
	if (a.ratio === null || b.ratio === null) {
		if (a.ratio === b.ratio) return a.name.localeCompare(b.name, 'cs')

		return a.ratio === null ? 1 : -1
	}

	return b.ratio - a.ratio || a.name.localeCompare(b.name, 'cs')
}

function AttendanceLine({ row }: { row: AttendanceRow }) {
	return (
		<li className="flex items-center gap-3 px-4 py-3">
			<Avatar name={row.name} src={row.avatarUrl} jerseyNumber={row.jerseyNumber} size="sm" />
			<div className="min-w-0 flex-1">
				<p className="truncate font-medium">
					{row.name}
					{row.jerseyNumber === null ? null : <span className="text-ink-faint ml-2 text-sm">#{row.jerseyNumber}</span>}
				</p>
				<p className="text-ink-faint mt-0.5 text-xs">
					{row.present} z {row.total} akcí
					{row.injured === 0 ? null : ` · ${row.injured}× zraněný`}
				</p>
			</div>

			<Bar ratio={row.ratio} />

			<span className="w-14 text-right font-medium tabular-nums">{formatRatio(row.ratio)}</span>
		</li>
	)
}

/** Pruh je doplněk k číslu, ne jeho náhrada — sám o sobě žádnou informaci nenese. */
function Bar({ ratio }: { ratio: number | null }) {
	if (ratio === null) return <div className="hidden w-24 sm:block" />

	return (
		<div className="bg-surface-3 hidden h-2 w-24 overflow-hidden rounded-full sm:block" aria-hidden="true">
			<div
				className={cn('h-full rounded-full', ratio >= 0.75 ? 'bg-bonus-500' : 'bg-brand-600')}
				style={{ width: `${Math.round(ratio * 100)}%` }}
			/>
		</div>
	)
}

const filters: Array<{ value: EventType | 'all'; label: string }> = [
	{ value: 'all', label: 'Vše' },
	{ value: 'training', label: 'Tréninky' },
	{ value: 'match', label: 'Zápasy' },
]

function TypeFilter({ value, onChange }: { value: EventType | 'all'; onChange: (value: EventType | 'all') => void }) {
	return (
		<div className="bg-surface-2 flex gap-1 rounded-xl p-1" role="group" aria-label="Druh akce">
			{filters.map((filter) => (
				<button
					key={filter.value}
					type="button"
					onClick={() => onChange(filter.value)}
					aria-pressed={value === filter.value}
					className={cn(
						'min-h-11 flex-1 rounded-lg px-3 text-sm transition-colors',
						value === filter.value ? 'bg-surface-0 text-ink font-medium' : 'text-ink-muted',
					)}
				>
					{filter.label}
				</button>
			))}
		</div>
	)
}
