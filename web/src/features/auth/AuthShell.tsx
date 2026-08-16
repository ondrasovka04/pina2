import type { ReactNode } from 'react'

import { ClubMark } from '@/components/ClubMark'

/** Rám obrazovek před přihlášením — znak, modrá záře, úzký sloupec. */
export function AuthShell({ children }: { children: ReactNode }) {
	return (
		<main className="relative grid min-h-dvh place-items-center overflow-hidden px-5 py-10">
			<div
				aria-hidden="true"
				className="from-brand-500/25 pointer-events-none absolute inset-x-0 top-0 h-80 bg-radial to-transparent to-70%"
			/>
			<div className="relative w-full max-w-sm">
				<ClubMark className="mb-6 h-16" />
				{children}
			</div>
		</main>
	)
}
