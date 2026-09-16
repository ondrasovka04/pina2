import type { ReactNode, RefObject } from 'react'
import { createContext, useContext, useEffect, useId, useRef, useState } from 'react'

import { ArrowLeftIcon, CheckIcon, XIcon } from '@/components/ui/icons'
import { useRsvpConfirmation } from '@/features/events/useRsvpConfirmation'
import { ApiError } from '@/lib/api'
import { cn } from '@/lib/cn'
import { useSaveRsvp } from '@/lib/queries'
import type { Rsvp, TeamEvent } from '@/lib/types'

interface CalendarRsvpRowProps {
	event: TeamEvent
	seasonId: number
	children: ReactNode
}

interface OpenRow {
	element: HTMLDivElement
	close: () => void
}

const OpenRowContext = createContext<RefObject<OpenRow | null> | null>(null)

export function CalendarRsvpRows({ children }: { children: ReactNode }) {
	const openRow = useRef<OpenRow | null>(null)
	return <OpenRowContext value={openRow}>{children}</OpenRowContext>
}

/** Nativní posouvání rozliší vodorovné gesto od rolování stránky i klepnutí na odkaz. */
export function CalendarRsvpRow({ event, seasonId, children }: CalendarRsvpRowProps) {
	const openRow = useContext(OpenRowContext)
	const scroller = useRef<HTMLDivElement>(null)
	const closing = useRef(false)
	const toggle = useRef<HTMLButtonElement>(null)
	const actionsId = useId()
	const [revealed, setRevealed] = useState(false)
	const [pending, setPending] = useState<Rsvp | null>(null)
	const [error, setError] = useState<string | null>(null)
	const [saved, setSaved] = useState<string | null>(null)
	const saving = useRef(false)
	const saveRsvp = useSaveRsvp(event.id, seasonId)

	useEffect(() => {
		const element = scroller.current
		return () => {
			if (openRow?.current?.element === element) {
				openRow.current = null
			}
		}
	}, [openRow])

	useEffect(() => {
		if (saved === null) {
			return
		}
		const timeout = window.setTimeout(() => setSaved(null), 3000)
		return () => window.clearTimeout(timeout)
	}, [saved])

	const { requestSave, confirmation } = useRsvpConfirmation(event, (rsvp: 'yes' | 'no') => void respond(rsvp))

	function claimRow(element: HTMLDivElement) {
		if (openRow === null || openRow.current?.element === element) {
			return
		}
		const previous = openRow.current
		openRow.current = { element, close: () => reveal(false) }
		previous?.close()
	}

	function reveal(open: boolean) {
		const element = scroller.current
		if (element === null) {
			return
		}
		closing.current = !open
		if (open) {
			claimRow(element)
		} else {
			setRevealed(false)
		}
		element.scrollTo({
			left: open ? element.scrollWidth - element.clientWidth : 0,
			behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth',
		})
	}

	async function respond(rsvp: 'yes' | 'no') {
		if (event.me === null || saving.current) {
			return
		}
		saving.current = true
		setPending(rsvp)
		setError(null)
		setSaved(null)
		try {
			await saveRsvp.mutateAsync({
				rsvp,
				note: event.me.rsvpNote,
				transport: event.me.transport,
				carSeats: event.me.carSeats,
			})
			setSaved(rsvp === 'yes' ? 'Uloženo: jdu' : 'Uloženo: nejdu')
			toggle.current?.focus({ preventScroll: true })
			reveal(false)
		} catch (cause) {
			setError(cause instanceof ApiError ? cause.message : 'Odpověď se nepodařilo uložit. Zkus to znovu.')
		} finally {
			saving.current = false
			setPending(null)
		}
	}

	return (
		<div>
			{confirmation}
			<div
				ref={scroller}
				onScroll={(e) => {
					const element = e.currentTarget
					const open = element.scrollLeft > 1
					if (!open) {
						closing.current = false
						if (openRow?.current?.element === element) {
							openRow.current = null
						}
					} else if (!closing.current) {
						claimRow(element)
					}
					// Dobíhající zavírání nesmí přebrat nabídku nově otevřenému řádku.
					setRevealed(open && !closing.current)
				}}
				onKeyDown={(e) => {
					if (e.key === 'Escape' && revealed) {
						toggle.current?.focus({ preventScroll: true })
						reveal(false)
					}
				}}
				className="flex snap-x snap-mandatory scrollbar-none overflow-x-auto overscroll-x-contain [&::-webkit-scrollbar]:hidden"
			>
				<div className="bg-surface-1 flex w-full shrink-0 snap-start items-stretch">
					{children}
					<button
						ref={toggle}
						type="button"
						aria-label={`Účast na akci: ${event.title}`}
						aria-expanded={revealed}
						aria-controls={actionsId}
						onClick={() => reveal(!revealed)}
						className="text-ink-muted hover:bg-surface-2 border-line/40 inline-grid w-11 shrink-0 place-items-center border-l"
					>
						<ArrowLeftIcon className={cn('size-4', revealed && 'rotate-180')} />
					</button>
				</div>
				<div
					id={actionsId}
					role="group"
					aria-label={`Odpověď na akci: ${event.title}`}
					inert={!revealed}
					aria-hidden={!revealed}
					className="flex w-40 shrink-0 snap-end items-stretch"
				>
					{(['yes', 'no'] as const).map((rsvp) => (
						<button
							key={rsvp}
							type="button"
							aria-pressed={event.me?.rsvp === rsvp}
							disabled={pending !== null}
							onClick={() => {
								if (event.me?.rsvp !== rsvp && !saving.current) {
									requestSave(rsvp)
								}
							}}
							className={cn(
								'flex min-h-11 w-20 flex-col items-center justify-center gap-1 border-2 px-1 py-2 text-sm font-semibold disabled:opacity-50',
								rsvp === 'yes' ? 'bg-bonus-500/15 text-bonus' : 'bg-debt-500/15 text-debt',
								event.me?.rsvp === rsvp ? 'border-current' : 'border-transparent',
							)}
						>
							{rsvp === 'yes' ? <CheckIcon className="size-5" /> : <XIcon className="size-5" />}
							{pending === rsvp ? 'Ukládám…' : rsvp === 'yes' ? 'Jdu' : 'Nejdu'}
						</button>
					))}
				</div>
			</div>
			{error === null ? null : (
				<p role="alert" className="text-debt px-4 pb-3 text-sm">
					{error}
				</p>
			)}
			{saved === null ? null : (
				<p role="status" className="text-ink-muted px-4 pb-2 text-xs">
					{saved}
				</p>
			)}
		</div>
	)
}
