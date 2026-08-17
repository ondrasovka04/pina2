import type { SelectHTMLAttributes } from 'react'

import { ChevronDownIcon } from '@/components/ui/icons'
import { cn } from '@/lib/cn'

interface SelectProps extends SelectHTMLAttributes<HTMLSelectElement> {
	/** Odsazení a šířka patří obalu, ne samotnému `select`. */
	wrapperClassName?: string
}

/**
 * Výběr ze seznamu se systémovým vzhledem vypnutým.
 *
 * Safari u `<select>` ignoruje `min-height` **i svislý padding**, takže vedle
 * běžného pole byl o třetinu nižší. Zabírá jen `appearance-none` — a s ním musí
 * přijít i vlastní šipka. Proč se styl nepřepisuje zvenčí, stojí ve web/AGENTS.md.
 *
 * Výšku 44 px drží základní pravidlo v `styles.css`, ne třída tady. Menší
 * varianta proto neexistuje: to pravidlo platí na každý `select` a je tam kvůli
 * velikosti plochy pro prst.
 */
export function Select({ wrapperClassName, className, ...rest }: SelectProps) {
	return (
		<span className={cn('relative flex', wrapperClassName)}>
			<select
				className={cn(
					'border-line bg-surface-2 text-ink peer w-full appearance-none rounded-xl border py-2.5 pr-9 pl-3 text-base',
					'disabled:opacity-50',
					className,
				)}
				{...rest}
			/>
			<ChevronDownIcon className="text-ink-faint pointer-events-none absolute top-1/2 right-3 size-4 -translate-y-1/2 peer-disabled:opacity-50" />
		</span>
	)
}
