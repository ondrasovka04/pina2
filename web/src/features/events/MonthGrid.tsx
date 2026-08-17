import { Link } from 'react-router'

import { ChevronRightIcon } from '@/components/ui/icons'
import { formatTime, weekdayLabels, weekdays } from '@/features/events/events'
import { EventTypeDot } from '@/features/events/EventTypeMark'
import type { CalendarCell } from '@/features/events/month'
import { monthGrid, monthTitle, shiftMonth } from '@/features/events/month'
import { cn } from '@/lib/cn'
import type { TeamEvent } from '@/lib/types'

/** Kolik akcí se v buňce ukáže, než nastoupí souhrn „+N". */
const MAX_VISIBLE_EVENTS = 3

/** Měsíční mřížka — alternativa k výchozímu seznamu, hodí se na širší obrazovku. */
export function MonthGrid({
	month,
	events,
	onMonthChange,
}: {
	month: string
	events: TeamEvent[]
	onMonthChange: (month: string) => void
}) {
	const weeks = monthGrid(month, events)

	return (
		<div className="flex flex-col gap-2">
			<div className="flex items-center justify-between gap-2">
				<button
					type="button"
					onClick={() => onMonthChange(shiftMonth(month, -1))}
					aria-label="Předchozí měsíc"
					className="hover:bg-surface-2 flex size-11 shrink-0 items-center justify-center rounded-full transition-colors"
				>
					<ChevronRightIcon className="size-4 rotate-180" />
				</button>

				<h2 className="text-lg font-semibold capitalize">{monthTitle(month)}</h2>

				<button
					type="button"
					onClick={() => onMonthChange(shiftMonth(month, 1))}
					aria-label="Další měsíc"
					className="hover:bg-surface-2 flex size-11 shrink-0 items-center justify-center rounded-full transition-colors"
				>
					<ChevronRightIcon className="size-4" />
				</button>
			</div>

			<div className="text-ink-faint grid grid-cols-7 gap-1 text-center text-xs font-medium">
				{weekdays.map((day) => (
					<div key={day}>{weekdayLabels[day]}</div>
				))}
			</div>

			<div className="grid grid-cols-7 gap-1">
				{weeks.map((week) => week.days.map((day) => <DayCell key={day.date} day={day} />))}
			</div>
		</div>
	)
}

function DayCell({ day }: { day: CalendarCell }) {
	const dayNumber = Number(day.date.slice(8, 10))
	const visible = day.events.slice(0, MAX_VISIBLE_EVENTS)
	const hiddenCount = day.events.length - visible.length

	return (
		<div
			className={cn(
				'border-line/60 flex min-h-20 flex-col gap-0.5 rounded-lg border p-1 sm:min-h-24',
				day.inMonth ? 'bg-surface-1' : 'bg-surface-0',
			)}
		>
			<span
				className={cn(
					'inline-flex size-5 shrink-0 items-center justify-center self-end rounded-full text-xs',
					day.inMonth ? 'text-ink' : 'text-ink-faint',
					day.isToday && 'ring-accent font-bold ring-2',
				)}
			>
				{dayNumber}
			</span>

			<div className="flex min-w-0 flex-col gap-0.5">
				{visible.map((event) => (
					<Link
						key={event.id}
						to={`/akce/${event.id}`}
						className={cn(
							'text-ink flex items-center gap-1 truncate rounded px-1 text-[0.65rem] leading-tight',
							// Zápas je ta výjimečná akce, tak ať v mřížce vystoupí i tvarem, ne jen barvou.
							event.type === 'match' && 'font-semibold',
							event.status === 'cancelled' && 'text-ink-faint line-through',
						)}
					>
						<EventTypeDot type={event.type} />
						<span className="truncate">
							{formatTime(event.startsAt)} {event.title}
						</span>
					</Link>
				))}
				{hiddenCount > 0 ? <span className="text-ink-faint px-1 text-[0.65rem]">+{hiddenCount}</span> : null}
			</div>
		</div>
	)
}
