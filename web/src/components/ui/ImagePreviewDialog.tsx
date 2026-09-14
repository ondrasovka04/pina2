import { useEffect, useId, useRef, useState } from 'react'
import { createPortal } from 'react-dom'

import { XIcon } from '@/components/ui/icons'

interface ImagePreviewDialogProps {
	src: string
	name: string
	onClose: () => void
}

export function ImagePreviewDialog({ src, name, onClose }: ImagePreviewDialogProps) {
	const ref = useRef<HTMLDialogElement>(null)
	const titleId = useId()
	const [failed, setFailed] = useState(false)

	useEffect(() => {
		const dialog = ref.current
		if (dialog === null) return

		const previousFocus = document.activeElement
		const overflow = document.body.style.overflow
		document.body.style.overflow = 'hidden'
		dialog.showModal()

		return () => {
			dialog.close()
			document.body.style.overflow = overflow
			if (previousFocus instanceof HTMLElement && previousFocus.isConnected) {
				previousFocus.focus({ preventScroll: true })
			}
		}
	}, [])

	// Portál drží náhled mimo ořezání a průhlednost řádku hráče.
	return createPortal(
		<dialog
			ref={ref}
			aria-labelledby={titleId}
			onCancel={(event) => {
				event.preventDefault()
				onClose()
			}}
			onClick={(event) => {
				if (event.target === event.currentTarget) onClose()
			}}
			className="border-line bg-surface-1 text-ink backdrop:bg-surface-0/70 m-auto max-h-[calc(100dvh-2rem)] w-[calc(100%-2rem)] max-w-lg rounded-2xl border p-0 shadow-xl backdrop:backdrop-blur-md"
		>
			<div className="p-3">
				<div className="mb-3 flex items-center gap-3">
					<h2 id={titleId} className="min-w-0 flex-1 truncate pl-1 font-semibold">
						{name}
					</h2>
					<button
						type="button"
						aria-label="Zavřít náhled"
						onClick={onClose}
						className="bg-surface-2 text-ink-muted hover:text-ink inline-grid size-11 shrink-0 place-items-center rounded-full"
					>
						<XIcon className="size-5" />
					</button>
				</div>
				{failed ? (
					<p role="status" className="text-ink-muted px-4 py-12 text-center">
						Fotku se nepodařilo načíst.
					</p>
				) : (
					<img
						src={src}
						alt={`Profilová fotka: ${name}`}
						className="max-h-[calc(100dvh-8rem)] w-full rounded-xl object-contain"
						onError={() => setFailed(true)}
					/>
				)}
			</div>
		</dialog>,
		document.body,
	)
}
