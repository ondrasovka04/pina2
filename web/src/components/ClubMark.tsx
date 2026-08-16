import { cn } from '@/lib/cn'

// Aplikační značka — SVG odvozené ze znaku SK Prosek. Kreslí se jako SVG pro ostrost.
export function ClubMark({ className }: { className?: string }) {
	return (
		<svg viewBox="0 0 48 56" role="img" aria-label="Pína" className={cn('shrink-0', className)}>
			<path
				d="M24 2 44 9v20c0 12-9 21-20 25C13 50 4 41 4 29V9Z"
				className="fill-brand-800 stroke-gold-500"
				strokeWidth="2.5"
				strokeLinejoin="round"
			/>
			<g className="stroke-gold-300" strokeWidth="1.8" fill="none" strokeLinecap="round">
				<circle cx="24" cy="27" r="9.5" />
				<path d="M15.2 23.4c4.6 2.6 12.2 3.2 17.6-1.2" />
				<path d="M19.4 35.6c2.8-5.4 3.4-13.4.4-16.8" />
			</g>
		</svg>
	)
}
