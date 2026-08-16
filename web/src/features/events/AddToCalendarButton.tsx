import { Button } from '@/components/ui/Button'
import { CalendarIcon } from '@/components/ui/icons'
import { eventsToIcs, icsFileName } from '@/features/events/ics'
import type { TeamEvent } from '@/lib/types'

interface AddToCalendarButtonProps {
	events: TeamEvent[]
	teamName: string
	calendarName: string
	label: string
}

/** Stažení akcí jako `.ics`. Soubor se skládá čistě v prohlížeči, žádný požadavek na server. */
export function AddToCalendarButton({ events, teamName, calendarName, label }: AddToCalendarButtonProps) {
	function handleClick() {
		const ics = eventsToIcs(events, { teamName, calendarName })
		const blob = new Blob([ics], { type: 'text/calendar;charset=utf-8' })
		const url = URL.createObjectURL(blob)
		const link = document.createElement('a')

		link.href = url
		link.download = icsFileName(calendarName)
		// Safari stažení nespustí, pokud odkaz není v dokumentu — proto append/remove kolem kliku.
		document.body.appendChild(link)
		link.click()
		link.remove()
		// Okamžitá revokace by v Safari uměla stažení useknout, proto o tik později.
		setTimeout(() => URL.revokeObjectURL(url), 0)
	}

	return (
		<Button variant="ghost" size="sm" disabled={events.length === 0} onClick={handleClick}>
			<CalendarIcon className="size-4" />
			{label}
		</Button>
	)
}
