import type { ButtonHTMLAttributes, ReactNode } from 'react'

import { Spinner } from '@/components/ui/Spinner'
import { cn } from '@/lib/cn'

// primary: běžná. accent (zlatá): jediná hlavní — když svítí všechno, nesvítí nic.
type Variant = 'primary' | 'accent' | 'ghost' | 'danger'
type Size = 'sm' | 'md' | 'lg'

const variants: Record<Variant, string> = {
	primary: 'bg-brand-600 text-white hover:bg-brand-500 active:bg-brand-700',
	accent: 'bg-accent text-on-accent font-semibold hover:bg-accent/90 active:bg-accent',
	ghost: 'bg-surface-2 text-ink hover:bg-surface-3 active:bg-surface-3',
	danger: 'bg-debt-500 text-white hover:bg-debt-500/90 active:bg-debt-500',
}

const sizes: Record<Size, string> = {
	sm: 'px-3 text-sm gap-1.5',
	md: 'px-4 text-sm gap-2',
	lg: 'px-5 text-base gap-2 min-h-12',
}

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
	variant?: Variant
	size?: Size
	/** Zablokuje tlačítko a ukáže kroužek — brání dvojímu odeslání. */
	loading?: boolean
	fullWidth?: boolean
	children: ReactNode
}

export function Button({
	variant = 'primary',
	size = 'md',
	loading = false,
	fullWidth = false,
	className,
	disabled,
	children,
	type = 'button',
	...rest
}: ButtonProps) {
	return (
		<button
			type={type}
			disabled={disabled === true || loading}
			aria-busy={loading || undefined}
			className={cn(
				'inline-flex items-center justify-center rounded-xl transition-colors',
				'disabled:cursor-not-allowed disabled:opacity-50',
				variants[variant],
				sizes[size],
				fullWidth && 'w-full',
				className,
			)}
			{...rest}
		>
			{loading ? <Spinner /> : null}
			{children}
		</button>
	)
}
