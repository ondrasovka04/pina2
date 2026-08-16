import type { InputHTMLAttributes, ReactNode } from 'react'
import { useId } from 'react'

import { cn } from '@/lib/cn'

interface FieldProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'id'> {
	label: ReactNode
	/** Chyba od serveru nebo z validace; obarví rámeček a naváže se přes aria. */
	error?: string | undefined
	hint?: ReactNode
}

export function Field({ label, error, hint, className, ...rest }: FieldProps) {
	const id = useId()
	const hintId = `${id}-hint`
	const errorId = `${id}-error`
	const describedBy = cn(hint === undefined ? undefined : hintId, error === undefined ? undefined : errorId)

	return (
		<div className="flex flex-col gap-1.5">
			<label htmlFor={id} className="text-ink-muted text-sm font-medium">
				{label}
			</label>
			<input
				id={id}
				aria-invalid={error === undefined ? undefined : true}
				aria-describedby={describedBy === '' ? undefined : describedBy}
				className={cn(
					'rounded-xl border bg-surface-2 px-3 py-2.5 text-base text-ink transition-colors',
					'placeholder:text-ink-faint',
					error === undefined ? 'border-line' : 'border-debt-500',
					className,
				)}
				{...rest}
			/>
			{hint === undefined ? null : (
				<p id={hintId} className="text-ink-faint text-xs">
					{hint}
				</p>
			)}
			{error === undefined ? null : (
				<p id={errorId} role="alert" className="text-debt text-sm">
					{error}
				</p>
			)}
		</div>
	)
}
