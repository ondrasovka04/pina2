import type { ReactNode } from 'react'
import { useEffect, useId, useRef, useState } from 'react'
import { Link } from 'react-router'

import { useTeam } from '@/app/team'
import { CheckIcon, ChevronDownIcon } from '@/components/ui/icons'
import { cn } from '@/lib/cn'
import type { Season } from '@/lib/types'

/**
 * Přepínač družstva a sezóny.
 *
 * Nativní `<select>` tu nestačí ze dvou důvodů: potřebujeme přepínat dvě věci
 * naráz (tým a sezónu) a u sezóny ukázat, která je aktuální a která uzavřená.
 * Šipka proto sedí hned za názvem — když byla u pravého okraje, nebylo poznat,
 * že patří k němu.
 */
export function TeamSwitcher() {
	const { teams, team, seasons, season, selectTeam, selectSeason, can } = useTeam()
	const [open, setOpen] = useState(false)
	const panelId = useId()
	const containerRef = useRef<HTMLDivElement>(null)

	// Zavření klávesou i kliknutím vedle — panel překrývá obsah a musí jít pryč
	// bez trefování malého křížku.
	useEffect(() => {
		if (!open) return

		function onKeyDown(event: KeyboardEvent) {
			if (event.key === 'Escape') setOpen(false)
		}

		function onPointerDown(event: PointerEvent) {
			if (!(event.target instanceof Node)) return
			if (containerRef.current?.contains(event.target) === true) return

			setOpen(false)
		}

		document.addEventListener('keydown', onKeyDown)
		document.addEventListener('pointerdown', onPointerDown)

		return () => {
			document.removeEventListener('keydown', onKeyDown)
			document.removeEventListener('pointerdown', onPointerDown)
		}
	}, [open])

	if (team === null) return null

	// Admin panel potřebuje i v družstvu s jedinou sezónou — jinak by neměl kudy
	// založit další.
	const switchable = teams.length > 1 || seasons.length > 1 || can('admin')

	if (!switchable) {
		return (
			<div className="min-w-0">
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

					{/*
					 * Vstup do správy sezón patří sem, kde má člověk sezóny zrovna na mysli.
					 * Jen jeden odkaz — dvě tlačítka vedle sebe se do panelu nevešla
					 * a text se lámal. Zakládání nové sezóny je na té stránce.
					 */}
					{can('admin') ? (
						<div className="border-line/60 border-t p-2">
							<Link
								to="/sezony"
								onClick={() => setOpen(false)}
								className="hover:bg-surface-2 text-ink-muted block rounded-lg px-2 py-2 text-center text-sm"
							>
								Spravovat sezóny
							</Link>
						</div>
					) : null}
				</div>
			) : null}
		</div>
	)
}

function seasonDetail(season: Season): string {
	if (season.isCurrent) return 'probíhá'
	if (season.closedAt !== null) return 'uzavřená'

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
