import { useId, useState } from 'react'
import { createPortal } from 'react-dom'

import { ConfirmDialog } from '@/components/ui/ConfirmDialog'
import { canAnswer, deadlineState } from '@/features/events/events'
import type { Rsvp, TeamEvent } from '@/lib/types'

interface Pending<T> {
	value: T
	/** Omluva se bez důvodu neuloží, proto se na něj ptáme před odesláním. */
	askReason: boolean
	late: boolean
}

const lateNotice =
	'Termín pro zápis už uplynul. Změna se označí jako pozdní a může znamenat příplatek podle sazebníku družstva.'

/**
 * Než se odpověď uloží, hlídá dvě věci: důvod u „nepřijdu" a pozdní zápis.
 * Termín kontrolujeme až při kliknutí — může uplynout i na otevřené stránce.
 *
 * `answerOf` říká, jakou odpověď a poznámku by `value` uložilo; důvod se chce
 * při přepnutí na „nepřijdu" i při „nepřijdu" bez poznámky.
 */
export function useRsvpConfirmation<T>(
	event: TeamEvent,
	save: (value: T, reason?: string) => void,
	answerOf: (value: T) => { rsvp: Rsvp; note: string | null },
) {
	const [pending, setPending] = useState<Pending<T> | null>(null)
	const [reason, setReason] = useState('')
	const reasonId = useId()

	function requestSave(value: T) {
		if (!canAnswer(event)) {
			return
		}
		const { rsvp, note } = answerOf(value)
		const askReason = rsvp === 'no' && (event.me?.rsvp !== 'no' || (note ?? '').trim() === '')
		const late = deadlineState(event) === 'passed'

		if (askReason) {
			setReason(note ?? '')
			setPending({ value, askReason, late })
		} else if (late) {
			setPending({ value, askReason, late })
		} else {
			save(value)
		}
	}

	const trimmed = reason.trim()

	// Dialog existuje jen při dotazu, takže nic z jeho textu neleží zavřené v DOM.
	const confirmation =
		pending === null
			? null
			: createPortal(
					<ConfirmDialog
						open
						wide={pending.askReason}
						title={pending.askReason ? 'Proč nepřijdeš?' : 'Změnit účast po termínu?'}
						{...(pending.late ? { description: lateNotice } : {})}
						confirmLabel={pending.askReason ? 'Uložit: nepřijdu' : 'Ano, uložit změnu'}
						confirmDisabled={pending.askReason && trimmed === ''}
						onConfirm={() => {
							const { value, askReason } = pending
							setPending(null)
							if (canAnswer(event)) {
								save(value, askReason ? trimmed : undefined)
							}
						}}
						onCancel={() => setPending(null)}
					>
						{pending.askReason ? (
							<label htmlFor={reasonId} className="flex flex-col gap-1.5">
								<span className="text-ink-muted text-sm font-medium">Důvod omluvy</span>
								<textarea
									id={reasonId}
									value={reason}
									onChange={(e) => setReason(e.target.value)}
									rows={3}
									maxLength={255}
									placeholder="Napiš smysluplný a dostatečný důvod omluvy"
									className="border-line bg-surface-2 text-ink placeholder:text-ink-faint w-full rounded-xl border px-3 py-2.5 text-base"
								/>
							</label>
						) : undefined}
					</ConfirmDialog>,
					document.body,
				)

	return { requestSave, confirmation }
}
