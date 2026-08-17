import { cn } from '@/lib/cn'
import { formatDate } from '@/lib/types'
import type { BalancePeriod, PeriodKey } from '@/lib/types'

interface PeriodTabsProps {
	periods: BalancePeriod[]
	active: PeriodKey
	onChange: (period: PeriodKey) => void
}

/**
 * Přepínač pololetí nad čísly peněz. Když sezóna přelom nastavený nemá, přijde
 * jediné období a přepínač se nevykreslí — jedna záložka není volba.
 */
export function PeriodTabs({ periods, active, onChange }: PeriodTabsProps) {
	if (periods.length < 2) return null

	const current = periods.find((period) => period.key === active)

	return (
		<div className="border-line/60 bg-surface-1 border-t px-3 py-2.5">
			<div className="bg-surface-2 flex rounded-lg p-0.5 text-sm">
				{periods.map((period) => (
					<button
						key={period.key}
						type="button"
						aria-pressed={period.key === active}
						onClick={() => onChange(period.key)}
						className={cn(
							'min-h-9 flex-1 rounded-md px-2 transition-colors',
							period.key === active ? 'bg-brand-600 font-medium text-white' : 'text-ink-muted',
						)}
					>
						{period.label}
					</button>
				))}
			</div>
			{current === undefined ? null : (
				<p className="text-ink-faint mt-1.5 text-center text-xs">
					{formatDate(current.from)} – {formatDate(current.to)}
				</p>
			)}
		</div>
	)
}
