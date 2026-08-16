import { cn } from '@/lib/cn'

interface SpinnerProps {
	className?: string
	label?: string
}

// label je pro odečítač — vizuálně stačí kroužek, ale bez popisu by uživatel nevěděl.
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
