import { useEffect, useId, useRef, useState } from 'react'

import { Button } from '@/components/ui/Button'
import { invitationUrl } from '@/features/team/members'
import type { IssuedLink } from '@/lib/types'
import { formatDateTime } from '@/lib/types'

interface OneTimeLinkDialogProps {
	link: IssuedLink | null
	title: string
	description: string
	onClose: () => void
}

/**
 * Vydaný odkaz na jedno použití.
 *
 * Token drží server jen jako otisk, takže tohle je **jediná chvíle**, kdy jde
 * odkaz přečíst — po zavření dialogu se už nikde nedohledá a musí se vydat nový.
 * Text to říká nahlas, aby si ho člověk nezavřel omylem.
 *
 * E-maily se z aplikace neposílají (`MAIL_ENABLED=false`), odkaz se předává
 * v týmovém chatu nebo osobně.
 */
export function OneTimeLinkDialog({ link, title, description, onClose }: OneTimeLinkDialogProps) {
	const dialogRef = useRef<HTMLDialogElement>(null)
	const titleId = useId()
	const [copied, setCopied] = useState(false)

	useEffect(() => {
		const dialog = dialogRef.current
		if (dialog === null) return

		if (link !== null) {
			setCopied(false)
			if (!dialog.open) dialog.showModal()
		} else if (dialog.open) {
			dialog.close()
		}
	}, [link])

	const url = link === null ? '' : invitationUrl(link.token, window.location.origin)

	async function copy() {
		try {
			await navigator.clipboard.writeText(url)
			setCopied(true)
		} catch {
			// Bez HTTPS nebo bez svolení schránka nefunguje. Odkaz je vypsaný
			// v poli vedle, takže se dá označit a zkopírovat ručně.
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
				if (event.target === dialogRef.current) onClose()
			}}
			className="border-line bg-surface-1 text-ink m-auto w-[min(28rem,calc(100vw-2rem))] rounded-2xl border p-5 shadow-xl backdrop:bg-black/50"
		>
			<h2 id={titleId} className="text-lg font-semibold">
				{title}
			</h2>
			<p className="text-ink-muted mt-2 text-sm">{description}</p>

			{link === null ? null : (
				<>
					<p className="text-ink-muted mt-4 text-sm">
						Pro <span className="text-ink font-medium">{link.email}</span>, platí do {formatDateTime(link.expiresAt)}.
					</p>

					{/* Jen pro čtení, ale ne `disabled` — z zakázaného pole nejde označit text. */}
					<input
						readOnly
						value={url}
						onFocus={(event) => event.target.select()}
						className="border-line bg-surface-2 text-ink mt-2 w-full rounded-xl border px-3 py-2.5 font-mono text-xs"
					/>

					<p className="text-ink-faint mt-2 text-xs">
						Odkaz se už nikde nezobrazí — server si z něj pamatuje jen otisk. Když se ztratí, vydejte nový.
					</p>
				</>
			)}

			<div className="mt-5 flex justify-end gap-2">
				<Button autoFocus variant="ghost" onClick={onClose}>
					Zavřít
				</Button>
				<Button onClick={() => void copy()}>{copied ? 'Zkopírováno' : 'Kopírovat odkaz'}</Button>
			</div>
		</dialog>
	)
}
