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
	/** Číslo dresu se ukáže místo iniciál — hráči se mezi sebou znají spíš podle něj. */
	jerseyNumber?: number | null
	size?: 'sm' | 'md'
	className?: string
}

export function Avatar({ name, jerseyNumber = null, size = 'md', className }: AvatarProps) {
	const label = jerseyNumber === null ? initials(name) : String(jerseyNumber)

	return (
		<span
			aria-hidden="true"
			className={cn(
				'inline-grid shrink-0 place-items-center rounded-full bg-surface-3 font-semibold text-ink-muted',
				size === 'sm' ? 'size-8 text-xs' : 'size-10 text-sm',
				jerseyNumber === null ? null : 'tabular',
				className,
			)}
		>
			{label}
		</span>
	)
}
