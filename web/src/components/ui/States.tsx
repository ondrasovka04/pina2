import type { ReactNode } from 'react'

import { Button } from '@/components/ui/Button'
import { Spinner } from '@/components/ui/Spinner'
import { ApiError } from '@/lib/api'

export function LoadingState({ label = 'Načítá se…' }: { label?: string }) {
	return (
		<div className="text-ink-muted flex items-center justify-center gap-3 py-16">
			<Spinner className="size-5" />
			<span className="text-sm">{label}</span>
		</div>
	)
}

// Chyba z API — text ze serveru je konkrétnější než „něco se pokazilo".
export function ErrorState({ error, onRetry }: { error: unknown; onRetry?: () => void }) {
	const message =
		error instanceof ApiError ? error.message : 'Nepodařilo se načíst data. Zkontrolujte připojení a zkuste to znovu.'

	return (
		<div className="flex flex-col items-center gap-4 py-16 text-center">
			<p className="text-ink-muted max-w-sm text-sm">{message}</p>
			{onRetry === undefined ? null : (
				<Button variant="ghost" onClick={onRetry}>
					Zkusit znovu
				</Button>
			)}
		</div>
	)
}

export function EmptyState({
	title,
	description,
	action,
}: {
	title: string
	description?: string
	action?: ReactNode
}) {
	return (
		<div className="flex flex-col items-center gap-3 px-6 py-16 text-center">
			<p className="font-medium">{title}</p>
			{description === undefined ? null : <p className="text-ink-muted max-w-sm text-sm">{description}</p>}
			{action}
		</div>
	)
}
