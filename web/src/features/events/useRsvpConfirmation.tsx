import { useState } from 'react'
import { createPortal } from 'react-dom'

import { ConfirmDialog } from '@/components/ui/ConfirmDialog'
import { canAnswer, deadlineState } from '@/features/events/events'
import type { TeamEvent } from '@/lib/types'

/** Termín kontrolujeme až při kliknutí — může uplynout i na otevřené stránce. */
export function useRsvpConfirmation<T>(event: TeamEvent, save: (value: T) => void) {
	const [pending, setPending] = useState<{ value: T } | null>(null)

	function requestSave(value: T) {
		if (!canAnswer(event)) return
		if (deadlineState(event) === 'passed') {
			setPending({ value })
		} else {
			save(value)
		}
	}

	const confirmation =
		event.rsvpDeadlineAt === null
			? null
			: createPortal(
					<ConfirmDialog
						open={pending !== null}
						title="Změnit účast po termínu?"
						description="Termín pro zápis už uplynul. Změna se označí jako pozdní a může znamenat příplatek podle sazebníku družstva. Chceš ji přesto uložit?"
						confirmLabel="Ano, uložit změnu"
						onConfirm={() => {
							if (pending === null) return
							const { value } = pending
							setPending(null)
							if (canAnswer(event)) save(value)
						}}
						onCancel={() => setPending(null)}
					/>,
					document.body,
				)

	return { requestSave, confirmation }
}
