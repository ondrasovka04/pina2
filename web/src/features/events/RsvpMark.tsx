import { CheckIcon, XIcon } from '@/components/ui/icons'
import { rsvpLabels } from '@/features/events/events'
import { cn } from '@/lib/cn'
import type { Rsvp } from '@/lib/types'

/**
 * Barva jen pro rychlé skenování — text i ikona nesou tutéž informaci, pozná se
 * to i černobíle. Sdílené i s `RsvpTally` v detailu akce (součet za družstvo).
 */
export const rsvpStyles: Record<Rsvp, string> = {
	yes: 'bg-bonus-500/15 text-bonus',
	no: 'bg-debt-500/15 text-debt',
	unknown: 'bg-surface-2 text-ink-faint',
}

/** Odznak jedné odpovědi. Sdílený mezi detailem akce a řádkem v kalendáři. */
export function RsvpBadge({ rsvp, className }: { rsvp: Rsvp; className?: string }) {
	return (
		<span
			className={cn(
				'inline-flex shrink-0 items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium',
				rsvpStyles[rsvp],
				className,
			)}
		>
			{rsvp === 'yes' ? <CheckIcon className="size-3.5" /> : null}
			{rsvp === 'no' ? <XIcon className="size-3.5" /> : null}
			{rsvpLabels[rsvp]}
		</span>
	)
}
