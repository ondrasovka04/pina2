import { cn } from '@/lib/cn'

interface SpinnerProps {
	className?: string
	label?: string
}

/**
 * Čekání. `label` je pro odečítač obrazovky — vizuálně stačí kroužek,
 * ale bez popisu by uživatel se čtečkou nevěděl, že se něco děje.
 */
export function Spinner({ className, label = 'Načítá se' }: SpinnerProps) {
	return (
		<span
			role="status"
			aria-label={label}
			className={cn(
				'inline-block size-4 animate-spin rounded-full border-2 border-current border-t-transparent',
				className,
			)}
		/>
	)
}
