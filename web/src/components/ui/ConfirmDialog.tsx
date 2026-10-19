import type { ReactNode } from 'react'
import { useEffect, useId, useRef } from 'react'

import { Button } from '@/components/ui/Button'
import { cn } from '@/lib/cn'

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
	confirmDisabled?: boolean
	/** Širší varianta pro obsah s formulářovým polem — výchozí šířka je na samotné potvrzení příliš úzká. */
	wide?: boolean
	children?: ReactNode
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
	confirmDisabled = false,
	wide = false,
	children,
	onConfirm,
	onCancel,
}: ConfirmDialogProps) {
	const dialogRef = useRef<HTMLDialogElement>(null)
	const titleId = useId()
	const descriptionId = useId()

	useEffect(() => {
		const dialog = dialogRef.current
		if (dialog === null) {
			return
		}

		if (open) {
			if (!dialog.open) {
				dialog.showModal()
			}
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
				if (event.target === dialogRef.current) {
					onCancel()
				}
			}}
			// m-auto: Tailwind Preflight sráží okraje, bez toho by dialog byl v rohu.
			className={cn(
				'border-line bg-surface-1 text-ink m-auto w-[min(28rem,calc(100vw-2rem))] rounded-2xl border p-5 shadow-xl backdrop:bg-black/50',
				!wide && 'max-w-96',
			)}
		>
			<h2 id={titleId} className="text-lg font-semibold">
				{title}
			</h2>
			{description === undefined ? null : (
				<p id={descriptionId} className="text-ink-muted mt-2 text-sm">
					{description}
				</p>
			)}
			{children === undefined ? null : <div className="mt-4">{children}</div>}
			<div className="mt-5 flex justify-end gap-2">
				{/* autoFocus: past by jinak sedla na potvrzení a Enter by u nevratné
				akce omylem potvrdil. Prohlížeč fokus nastaví při showModal(), pokud
				je atribut autofocus na prvku v dialogu přítomný. */}
				<Button autoFocus variant="ghost" onClick={onCancel}>
					{cancelLabel}
				</Button>
				<Button variant={danger ? 'danger' : 'primary'} disabled={confirmDisabled} onClick={onConfirm}>
					{confirmLabel}
				</Button>
			</div>
		</dialog>
	)
}
