import type { HTMLAttributes, ReactNode } from 'react'

import { cn } from '@/lib/cn'

interface CardProps extends HTMLAttributes<HTMLDivElement> {
	children: ReactNode
}

export function Card({ className, children, ...rest }: CardProps) {
	return (
		<div className={cn('rounded-2xl border border-line/60 bg-surface-1', className)} {...rest}>
			{children}
		</div>
	)
}

interface CardHeaderProps {
	title: ReactNode
	subtitle?: ReactNode
	/** Akce vpravo v hlavičce — typicky jedno tlačítko. */
	action?: ReactNode
}

export function CardHeader({ title, subtitle, action }: CardHeaderProps) {
	return (
		<div className="border-line/60 flex items-start justify-between gap-3 border-b px-4 py-3">
			<div className="min-w-0">
				<h2 className="truncate font-semibold">{title}</h2>
				{subtitle === undefined ? null : <p className="text-ink-muted mt-0.5 text-sm">{subtitle}</p>}
			</div>
			{action}
		</div>
	)
}
