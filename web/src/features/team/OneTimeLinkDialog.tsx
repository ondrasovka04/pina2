import { useEffect, useId, useRef, useState } from 'react'

import { Button } from '@/components/ui/Button'
import { invitationUrl } from '@/features/team/members'
import { cn } from '@/lib/cn'
import type { IssuedLink } from '@/lib/types'
import { formatDateTime } from '@/lib/types'

interface OneTimeLinkDialogProps {
	link: IssuedLink | null
	title: string
	description: string
	onClose: () => void
}

/**
 * Token se zobrazí jen jednou — server si ho pamatuje jen jako otisk.
 * E-maily se neposílají, odkaz se předává v chatu.
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
					<p
						className={cn(
							'mt-4 rounded-xl px-3 py-2 text-sm',
							link.emailSent ? 'bg-bonus-500/15 text-ink' : 'bg-surface-2 text-ink-muted',
						)}
					>
						{link.emailSent
							? `Zpráva odešla na ${link.email}.`
							: `E-mail neodešel — pošlete odkaz na ${link.email} sami.`}
					</p>

					<p className="text-ink-muted mt-3 text-sm">Platí do {formatDateTime(link.expiresAt)}.</p>

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
