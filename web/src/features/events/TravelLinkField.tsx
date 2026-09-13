import { Select } from '@/components/ui/Select'
import { formatEventTime, linkableMatches } from '@/features/events/events'
import type { TeamEvent } from '@/lib/types'

/**
 * Dvojzápas: napojení na jinou akci výjezdu. Auta i vzdálenost pak nese jen ta
 * vybraná, tahle dál drží jen svou vlastní docházku a nominaci — sdílené
 * mezi založením i úpravou akce, ať se pravidlo nerozjíždí na dvou místech.
 */
export function TravelLinkField({
	events,
	excludeEventId,
	referenceStartsAt,
	value,
	onChange,
}: {
	events: TeamEvent[]
	excludeEventId: number | null
	/** Datum upravované akce — kandidáti se řadí podle blízkosti k němu. */
	referenceStartsAt: string
	value: number | null
	onChange: (value: number | null) => void
}) {
	const options = linkableMatches(events, excludeEventId, referenceStartsAt)

	return (
		<label className="flex flex-col gap-1.5">
			<span className="text-ink-muted text-sm font-medium">Dvojzápas</span>
			<Select
				value={value ?? ''}
				onChange={(event) => onChange(event.target.value === '' ? null : Number.parseInt(event.target.value, 10))}
				aria-label="Napojit na jinou akci"
			>
				<option value="">Samostatná akce — auta se nastavují tady</option>
				{options.map((event) => (
					<option key={event.id} value={event.id}>
						{event.title} · {formatEventTime(event.startsAt)}
					</option>
				))}
			</Select>
			<p className="text-ink-faint text-xs">
				{value === null
					? 'Vyberte, pokud jde o druhý zápas stejného výjezdu — jinak by cesťák vznikl dvakrát.'
					: 'Auta a cesťák se nastavují u vybrané akce, tahle jen nese vlastní docházku.'}
			</p>
		</label>
	)
}
