import { useEffect, useId, useRef, useState } from 'react'

import { Button } from '@/components/ui/Button'
import { CalendarIcon } from '@/components/ui/icons'
import type { IssuedCalendarFeed } from '@/lib/types'

interface CalendarFeedDialogProps {
	feed: IssuedCalendarFeed | null
	onClose: () => void
}

export function calendarFeedUrls(token: string, origin: string) {
	const http = new URL(`/api/v1/calendar/${token}.ics`, origin).toString()

	return { http, webcal: http.replace(/^https?:/, 'webcal:') }
}

/** Tajnou adresu drží jen stav otevřeného dialogu; po zavření se zahodí. */
export function CalendarFeedDialog({ feed, onClose }: CalendarFeedDialogProps) {
	const dialogRef = useRef<HTMLDialogElement>(null)
	const titleId = useId()
	const [copied, setCopied] = useState(false)

	useEffect(() => {
		const dialog = dialogRef.current
		if (dialog === null) {
			return
		}

		if (feed !== null) {
			setCopied(false)
			if (!dialog.open) {
				dialog.showModal()
			}
		} else if (dialog.open) {
			dialog.close()
		}
	}, [feed])

	const urls = feed === null ? null : calendarFeedUrls(feed.token, window.location.origin)

	async function copy() {
		if (urls === null) {
			return
		}

		try {
			await navigator.clipboard.writeText(urls.webcal)
			setCopied(true)
		} catch {
			setCopied(false)
		}
	}

	return (
		<dialog
			ref={dialogRef}
			aria-labelledby={titleId}
			onCancel={(event) => {
				event.preventDefault()
				onClose()
			}}
			onClick={(event) => {
				if (event.target === dialogRef.current) {
					onClose()
				}
			}}
			className="border-line bg-surface-1 text-ink m-auto w-[min(30rem,calc(100vw-2rem))] rounded-2xl border p-5 shadow-xl backdrop:bg-black/50"
		>
			<h2 id={titleId} className="text-lg font-semibold">
				Odebírat kalendář
			</h2>
			{feed === null || urls === null ? null : (
				<>
					<p className="text-ink-muted mt-2 text-sm">
						{feed.teamName} · {feed.seasonName}. Změny termínů se do kalendáře propíšou automaticky.
					</p>

					<a
						href={urls.webcal}
						className="bg-brand-600 mt-5 inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-xl px-4 text-sm font-semibold text-white"
					>
						<CalendarIcon className="size-4" />
						Přidat do kalendáře
					</a>

					<input
						readOnly
						value={urls.webcal}
						onFocus={(event) => event.target.select()}
						aria-label="Adresa odběru"
						className="border-line bg-surface-2 text-ink mt-4 w-full rounded-xl border px-3 py-2.5 font-mono text-xs"
					/>
					<p className="text-ink-faint mt-2 text-xs">
						Adresa se už nikde nezobrazí. Chová se jako heslo; při ztrátě telefonu ji zneplatněte v profilu.
					</p>
				</>
			)}

			<div className="mt-5 flex justify-end gap-2">
				<Button autoFocus variant="ghost" onClick={onClose}>
					Zavřít
				</Button>
				<Button onClick={() => void copy()}>{copied ? 'Zkopírováno' : 'Kopírovat adresu'}</Button>
			</div>
		</dialog>
	)
}
