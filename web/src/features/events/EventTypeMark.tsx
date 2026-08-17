import { cn } from '@/lib/cn'
import type { EventType } from '@/lib/types'
import { eventTypeLabels } from '@/lib/types'

/**
 * Odlišení tréninku, zápasu a jiné akce. Barva je jen pomůcka pro rychlé
 * skenování kalendáře — nikdy nenese informaci sama, vždycky je vedle ní název
 * typu nebo aspoň v přístupném popisu. Kdo barvy nerozliší, přečte si to.
 */

const textClass: Record<EventType, string> = {
	training: 'text-event-training',
	match: 'text-event-match',
	other: 'text-event-other',
}

const dotClass: Record<EventType, string> = {
	training: 'bg-event-training',
	match: 'bg-event-match',
	other: 'bg-event-other',
}

/** Štítek s názvem typu. Do seznamu akcí, kde je na text místo. */
export function EventTypeBadge({ type, className }: { type: EventType; className?: string }) {
	return (
		<span
			className={cn(
				'border-line bg-surface-2 shrink-0 rounded-full border px-2 py-0.5 text-xs font-medium',
				textClass[type],
				className,
			)}
		>
			{eventTypeLabels[type]}
		</span>
	)
}

/**
 * Tečka do měsíční mřížky, kde na štítek místo není. Název typu jde do
 * přístupného popisu, protože samotná barva by pro čtečku nic neznamenala.
 */
export function EventTypeDot({ type, className }: { type: EventType; className?: string }) {
	return (
		<span className={cn('inline-flex shrink-0 items-center', className)}>
			<span aria-hidden className={cn('size-1.5 rounded-full', dotClass[type])} />
			<span className="sr-only">{eventTypeLabels[type]}: </span>
		</span>
	)
}

/** Barva textu pro daný typ — pro nadpisy, kde by štítek byl navíc. */
export function eventTypeTextClass(type: EventType): string {
	return textClass[type]
}
