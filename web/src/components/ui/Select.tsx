import type { SelectHTMLAttributes } from 'react'

import { ChevronDownIcon } from '@/components/ui/icons'
import { cn } from '@/lib/cn'

interface SelectProps extends SelectHTMLAttributes<HTMLSelectElement> {
	/** Menší varianta do řádku textu — jinde se používá základní velikost. */
	compact?: boolean
	/** Odsazení a šířka patří obalu, ne samotnému `select`. */
	wrapperClassName?: string
}

/**
 * Výběr ze seznamu se systémovým vzhledem vypnutým.
 *
 * Safari u `<select>` ignoruje `min-height` **i svislý padding**, takže vedle
 * běžného pole byl o třetinu nižší. Zabírá jen `appearance-none` — a s ním musí
 * přijít i vlastní šipka. Proč se styl nepřepisuje zvenčí, stojí ve web/AGENTS.md.
 */
export function Select({ compact = false, wrapperClassName, className, ...rest }: SelectProps) {
	return (
		<span className={cn('relative flex', wrapperClassName)}>
			<select
				className={cn(
					'border-line bg-surface-2 text-ink appearance-none border disabled:opacity-50',
					compact ? 'rounded-lg py-1 pr-7 pl-2 text-sm' : 'min-h-11 w-full rounded-xl py-2.5 pr-9 pl-3 text-base',
					className,
				)}
				{...rest}
			/>
			<ChevronDownIcon
				className={cn(
					'text-ink-faint pointer-events-none absolute top-1/2 -translate-y-1/2',
					compact ? 'right-2 size-3.5' : 'right-3 size-4',
				)}
			/>
		</span>
	)
}
