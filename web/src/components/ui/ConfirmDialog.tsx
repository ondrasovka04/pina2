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

/**
 * Postaveno na nativním `<dialog>` — zdarma dostaneme past na fokus, zavření
 * Escapem a vrstvení nad vším ostatním. `open` je jediný zdroj pravdy, dialog
 * sám o sobě žádný stav nedrží.
 */
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
				// Escape zavírá dialog sám — zavření musí řídit rodič přes `open`,
				// jinak by stav zůstal `open: true` a dialog by se už nedal otevřít.
				event.preventDefault()
				onCancel()
			}}
			onClick={(event) => {
				// Klik na podklad (::backdrop) doráží click event na samotný
				// <dialog>, klik na obsah na jeho potomky — tím je jde rozlišit.
				if (event.target === dialogRef.current) onCancel()
			}}
			/*
			 * `m-auto` tu musí být: prohlížeč modální dialog centruje přes
			 * `margin: auto`, jenže Tailwind Preflight sráží okraje na nulu
			 * a dialog by skončil v levém horním rohu.
			 */
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
