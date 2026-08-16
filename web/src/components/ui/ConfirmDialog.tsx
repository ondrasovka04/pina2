import { useEffect, useId, useRef } from 'react'

import { Button } from '@/components/ui/Button'

interface ConfirmDialogProps {
	open: boolean
	title: string
	description?: string
	/** Výchozí „Potvrdit". */
	confirmLabel?: string
	/** Výchozí „Zrušit". */
	cancelLabel?: string
	/** Potvrzovací tlačítko červeně — pro nevratné akce. */
	danger?: boolean
	onConfirm: () => void
	onCancel: () => void
}

// Nativní <dialog> — past na fokus, Escape, vrstvení. `open` je jediný zdroj pravdy.
export function ConfirmDialog({
	open,
	title,
	description,
	confirmLabel = 'Potvrdit',
	cancelLabel = 'Zrušit',
	danger = false,
	onConfirm,
	onCancel,
}: ConfirmDialogProps) {
	const dialogRef = useRef<HTMLDialogElement>(null)
	const titleId = useId()
	const descriptionId = useId()

	useEffect(() => {
		const dialog = dialogRef.current
		if (dialog === null) return

		if (open) {
			if (!dialog.open) dialog.showModal()
		} else if (dialog.open) {
			dialog.close()
		}
	}, [open])

	return (
		<dialog
			ref={dialogRef}
			aria-labelledby={titleId}
			aria-describedby={description === undefined ? undefined : descriptionId}
			onCancel={(event) => {
				// Escape: rodič musí zavřít skrz `open`, ne dialog sám.
				event.preventDefault()
				onCancel()
			}}
			onClick={(event) => {
				// Klik na podklad dorazí na <dialog> sám, na obsah na potomky.
				if (event.target === dialogRef.current) onCancel()
			}}
			// m-auto: Tailwind Preflight sráží okraje, bez toho by dialog byl v rohu.
			className="border-line bg-surface-1 text-ink m-auto max-w-96 rounded-2xl border p-5 shadow-xl backdrop:bg-black/50"
		>
			<h2 id={titleId} className="text-lg font-semibold">
				{title}
			</h2>
			{description === undefined ? null : (
				<p id={descriptionId} className="text-ink-muted mt-2 text-sm">
					{description}
				</p>
			)}
			<div className="mt-5 flex justify-end gap-2">
				{/* autoFocus: past by jinak sedla na potvrzení a Enter by u nevratné
				akce omylem potvrdil. Prohlížeč fokus nastaví při showModal(), pokud
				je atribut autofocus na prvku v dialogu přítomný. */}
				<Button autoFocus variant="ghost" onClick={onCancel}>
					{cancelLabel}
				</Button>
				<Button variant={danger ? 'danger' : 'primary'} onClick={onConfirm}>
					{confirmLabel}
				</Button>
			</div>
		</dialog>
	)
}
