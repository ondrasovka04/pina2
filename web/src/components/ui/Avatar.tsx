import { useEffect, useState } from 'react'

import { ImagePreviewDialog } from '@/components/ui/ImagePreviewDialog'
import { cn } from '@/lib/cn'

/** „Ondřej Kopáč" → „OK". Jedno slovo dá jedno písmeno, prázdné jméno pomlčku. */
export function initials(name: string): string {
	const words = name.trim().split(/\s+/).filter(Boolean)
	if (words.length === 0) return '–'

	const first = words[0] ?? ''
	const last = words.length > 1 ? (words.at(-1) ?? '') : ''

	return (first.slice(0, 1) + last.slice(0, 1)).toLocaleUpperCase('cs-CZ')
}

interface AvatarProps {
	name: string
	src?: string | null
	/** Číslo dresu se ukáže místo iniciál — hráči se mezi sebou znají spíš podle něj. */
	jerseyNumber?: number | null
	size?: 'sm' | 'md'
	className?: string
	preview?: boolean
}

export function Avatar({
	name,
	src = null,
	jerseyNumber = null,
	size = 'md',
	className,
	preview = false,
}: AvatarProps) {
	const [failed, setFailed] = useState(false)
	const [previewSrc, setPreviewSrc] = useState<string | null>(null)

	useEffect(() => setFailed(false), [src])

	const label = jerseyNumber === null ? initials(name) : String(jerseyNumber)

	const avatar = (
		<span
			aria-hidden="true"
			className={cn(
				'inline-grid shrink-0 place-items-center rounded-full bg-surface-3 font-semibold text-ink-muted',
				size === 'sm' ? 'size-8 text-xs' : 'size-10 text-sm',
				jerseyNumber === null ? null : 'tabular',
				className,
			)}
		>
			{src !== null && !failed ? (
				<img src={src} alt="" className="size-full rounded-full object-cover" onError={() => setFailed(true)} />
			) : (
				label
			)}
		</span>
	)

	if (!preview) return avatar
	if (src === null || failed) {
		return <span className="inline-grid min-h-11 min-w-11 shrink-0 place-items-center">{avatar}</span>
	}

	return (
		<>
			<button
				type="button"
				aria-label={`Zvětšit profilovou fotku: ${name}`}
				aria-haspopup="dialog"
				onClick={() => setPreviewSrc(src)}
				className="inline-grid min-h-11 min-w-11 shrink-0 cursor-zoom-in place-items-center rounded-full"
			>
				{avatar}
			</button>
			{previewSrc === src ? <ImagePreviewDialog src={src} name={name} onClose={() => setPreviewSrc(null)} /> : null}
		</>
	)
}
