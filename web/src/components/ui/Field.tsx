import type { InputHTMLAttributes, ReactNode } from 'react'
import { useId } from 'react'

import { cn } from '@/lib/cn'

interface FieldProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'id'> {
	label: ReactNode
	/** Chyba od serveru nebo z validace; obarví rámeček a naváže se přes aria. */
	error?: string | undefined
	hint?: ReactNode
	action?: ReactNode
}

export function Field({ label, error, hint, action, className, ...rest }: FieldProps) {
	const id = useId()
	const hintId = `${id}-hint`
	const errorId = `${id}-error`
	const describedBy = cn(hint === undefined ? undefined : hintId, error === undefined ? undefined : errorId)
	const input = (
		<input
			id={id}
			aria-invalid={error === undefined ? undefined : true}
			aria-describedby={describedBy === '' ? undefined : describedBy}
			className={cn(
				'rounded-xl border bg-surface-2 px-3 py-2.5 text-base text-ink transition-colors',
				'placeholder:text-ink-faint',
				error === undefined ? 'border-line' : 'border-debt-500',
				action !== undefined && 'min-w-0 flex-1',
				className,
			)}
			{...rest}
		/>
	)

	return (
		<div className="flex flex-col gap-1.5">
			<label htmlFor={id} className="text-ink-muted text-sm font-medium">
				{label}
			</label>
			{action === undefined ? (
				input
			) : (
				<div className="flex items-stretch gap-2">
					{input}
					{action}
				</div>
			)}
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
