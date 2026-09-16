import type { ReactNode } from 'react'
import { useEffect, useId, useRef, useState } from 'react'
import { Link } from 'react-router'

import { useCurrentUser } from '@/app/session'
import { useTeam } from '@/app/team'
import { CheckIcon, ChevronDownIcon } from '@/components/ui/icons'
import { cn } from '@/lib/cn'
import type { Season } from '@/lib/types'

// Přepínač týmu a sezóny — select nestačí, potřebujeme přepínat obojí
export function TeamSwitcher() {
	const { teams, team, seasons, season, selectTeam, selectSeason, can, usesAttendance } = useTeam()
	const { platformAdmin } = useCurrentUser()
	const [open, setOpen] = useState(false)
	const panelId = useId()
	const containerRef = useRef<HTMLDivElement>(null)

	// Zavření Escapem nebo kliknutím mimo
	useEffect(() => {
		if (!open) {
			return
		}

		function onKeyDown(event: KeyboardEvent) {
			if (event.key === 'Escape') {
				setOpen(false)
			}
		}

		function onPointerDown(event: PointerEvent) {
			if (!(event.target instanceof Node)) {
				return
			}
			if (containerRef.current?.contains(event.target) === true) {
				return
			}

			setOpen(false)
		}

		document.addEventListener('keydown', onKeyDown)
		document.addEventListener('pointerdown', onPointerDown)

		return () => {
			document.removeEventListener('keydown', onKeyDown)
			document.removeEventListener('pointerdown', onPointerDown)
		}
	}, [open])

	if (team === null) {
		return null
	}

	// Panel se otevírá i s jediným družstvem a sezónou — pínař i admin musí mít
	// kudy na sezóny, série a místa, i když není co přepínat.
	const canManage = can('treasurer')
	const switchable = teams.length > 1 || seasons.length > 1 || canManage || platformAdmin

	if (!switchable) {
		// `flex-1` tu musí být stejně jako u přepínatelné varianty: bez něj se
		// hlavička smrskne na šířku textu a navigace se k ní přilepí zleva
		// místo toho, aby zůstala u pravého okraje.
		return (
			<div className="min-w-0 flex-1">
				<p className="truncate font-semibold">{team.name}</p>
				<p className="text-ink-faint truncate text-xs">
					{team.clubName}
					{season === null ? null : ` · ${season.name}`}
				</p>
			</div>
		)
	}

	return (
		<div ref={containerRef} className="relative min-w-0 flex-1">
			<button
				type="button"
				onClick={() => setOpen((value) => !value)}
				aria-expanded={open}
				aria-controls={panelId}
				className="-my-1 flex min-h-0 max-w-full items-center gap-1 rounded-lg py-1 text-left"
			>
				<span className="min-w-0">
					<span className="flex items-center gap-1">
						<span className="truncate font-semibold">{team.name}</span>
						<ChevronDownIcon
							className={cn('text-ink-faint size-4 shrink-0 transition-transform', open && 'rotate-180')}
						/>
					</span>
					<span className="text-ink-faint block truncate text-xs">
						{team.clubName}
						{season === null ? null : ` · ${season.name}`}
					</span>
				</span>
			</button>

			{open ? (
				<div
					id={panelId}
					className="border-line bg-surface-1 absolute top-full left-0 z-30 mt-2 max-h-[70dvh] w-72 overflow-y-auto rounded-2xl border shadow-xl"
				>
					{teams.length > 1 ? (
						<Section title="Družstvo">
							{teams.map((item) => (
								<Option
									key={item.id}
									label={item.name}
									detail={item.clubName}
									selected={item.id === team.id}
									onSelect={() => {
										selectTeam(item.id)
										setOpen(false)
									}}
								/>
							))}
						</Section>
					) : null}

					{seasons.length > 0 ? (
						<Section title="Sezóna">
							{seasons.map((item) => (
								<Option
									key={item.id}
									label={item.name}
									detail={seasonDetail(item)}
									selected={item.id === season?.id}
									onSelect={() => {
										selectSeason(item.id)
										setOpen(false)
									}}
								/>
							))}
						</Section>
					) : null}

					{canManage || platformAdmin ? (
						<div className="border-line/60 flex flex-col border-t p-2">
							{/* Členové a role jsou správa účtů, ta zůstává adminovi. */}
							{can('admin') ? (
								<Link
									to="/druzstvo"
									onClick={() => setOpen(false)}
									className="hover:bg-surface-2 text-ink-muted flex min-h-11 items-center justify-center rounded-lg px-2 text-sm"
								>
									Spravovat družstva
								</Link>
							) : null}
							{/*
							 * Jen pínař a admin. Správce platformy, který je v tomhle družstvu
							 * hráč, tady mít odkazy nesmí — obrazovky by ho odmítly a příznak
							 * správce platformy není univerzální klíč, jen provozní role.
							 */}
							{canManage ? (
								<>
									<Link
										to="/sezony"
										onClick={() => setOpen(false)}
										className="hover:bg-surface-2 text-ink-muted flex min-h-11 items-center justify-center rounded-lg px-2 text-sm"
									>
										Sezóny a soupiska
									</Link>
									{/* Provoz akcí; družstvo, které docházku vede jinde, tyhle obrazovky nemá. */}
									{usesAttendance ? (
										<>
											<Link
												to="/serie"
												onClick={() => setOpen(false)}
												className="hover:bg-surface-2 text-ink-muted flex min-h-11 items-center justify-center rounded-lg px-2 text-sm"
											>
												Opakované akce
											</Link>
											<Link
												to="/mista"
												onClick={() => setOpen(false)}
												className="hover:bg-surface-2 text-ink-muted flex min-h-11 items-center justify-center rounded-lg px-2 text-sm"
											>
												Spravovat místa
											</Link>
										</>
									) : null}
								</>
							) : null}
							{platformAdmin ? (
								<Link
									to="/sprava"
									onClick={() => setOpen(false)}
									className="hover:bg-surface-2 text-ink-faint border-line/60 mt-1 flex min-h-11 items-center justify-center rounded-lg border-t px-2 pt-1 text-sm"
								>
									Správa platformy
								</Link>
							) : null}
						</div>
					) : null}
				</div>
			) : null}
		</div>
	)
}

function seasonDetail(season: Season): string {
	if (season.isCurrent) {
		return 'probíhá'
	}
	if (season.closedAt !== null) {
		return 'uzavřená'
	}

	return 'otevřená'
}

function Section({ title, children }: { title: string; children: ReactNode }) {
	return (
		<div className="border-line/60 border-b last:border-b-0">
			<p className="text-ink-faint px-4 pt-3 pb-1 text-xs font-medium tracking-wide uppercase">{title}</p>
			<ul className="pb-2">{children}</ul>
		</div>
	)
}

interface OptionProps {
	label: string
	detail: string
	selected: boolean
	onSelect: () => void
}

function Option({ label, detail, selected, onSelect }: OptionProps) {
	return (
		<li>
			<button
				type="button"
				onClick={onSelect}
				aria-current={selected || undefined}
				className={cn(
					'hover:bg-surface-2 flex w-full items-center gap-3 px-4 py-2 text-left transition-colors',
					selected && 'bg-brand-600/10',
				)}
			>
				<span className="min-w-0 flex-1">
					<span className="block truncate text-sm font-medium">{label}</span>
					<span className="text-ink-faint block truncate text-xs">{detail}</span>
				</span>
				{selected ? <CheckIcon className="text-accent size-4 shrink-0" /> : null}
			</button>
		</li>
	)
}
