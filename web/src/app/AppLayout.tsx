import type { ComponentType, SVGProps } from 'react'
import { Link, NavLink, Outlet } from 'react-router'

import { useTeam } from '@/app/team'
import { TeamSwitcher } from '@/app/TeamSwitcher'
import { ClubMark } from '@/components/ClubMark'
import { ListIcon, PlusIcon, UserIcon, WalletIcon } from '@/components/ui/icons'
import { ErrorState, LoadingState } from '@/components/ui/States'
import { cn } from '@/lib/cn'
import type { Role } from '@/lib/types'

interface NavItem {
	to: string
	label: string
	icon: ComponentType<SVGProps<SVGSVGElement>>
	/** Položka se ukáže jen tomu, kdo na ni má roli. */
	requires?: Role
}

const navItems: NavItem[] = [
	{ to: '/dluhy', label: 'Dluhy', icon: WalletIcon },
	{ to: '/zapsat', label: 'Zapsat', icon: PlusIcon, requires: 'treasurer' },
	{ to: '/sazebnik', label: 'Sazebník', icon: ListIcon },
	{ to: '/ja', label: 'Já', icon: UserIcon },
]

export function AppLayout() {
	const { team, can, isLoading, isSeasonLoading, isSeasonClosed, error } = useTeam()

	if (isLoading) return <LoadingState />
	if (error !== null) return <ErrorState error={error} />

	if (team === null) {
		return (
			<main className="grid min-h-dvh place-items-center px-6 text-center">
				<div>
					<h1 className="text-xl font-semibold">Nejste v žádném týmu</h1>
					<p className="text-ink-muted mt-2 text-sm">Požádejte pínaře nebo admina svého družstva, aby vás přidal.</p>
				</div>
			</main>
		)
	}

	const visible = navItems.filter((item) => item.requires === undefined || can(item.requires))

	return (
		<div className="flex min-h-dvh flex-col">
			<header
				className="border-line/60 bg-surface-0/85 sticky top-0 z-20 border-b backdrop-blur"
				style={{ paddingTop: 'env(safe-area-inset-top)' }}
			>
				<div className="mx-auto flex w-full max-w-3xl items-center gap-3 px-4 py-2.5">
					{/* Znak vede na přehled dluhů — to je domovská obrazovka aplikace. */}
					<Link to="/dluhy" aria-label="Přehled dluhů" className="shrink-0">
						<ClubMark className="h-8" />
					</Link>

					<TeamSwitcher />

					{isSeasonClosed ? (
						<span className="bg-surface-2 text-ink-muted shrink-0 rounded-lg px-2.5 py-1 text-xs font-medium">
							uzavřená
						</span>
					) : null}

					{/* Na širší obrazovce dává navigace smysl v hlavičce; spodní lišta je pro palec. */}
					<nav className="hidden md:flex md:items-center md:gap-1">
						{visible.map((item) => (
							<NavLink
								key={item.to}
								to={item.to}
								className={({ isActive }) =>
									cn(
										'rounded-lg px-3 py-2 text-sm transition-colors',
										isActive ? 'bg-brand-600/25 text-accent' : 'text-ink-muted hover:text-ink',
									)
								}
							>
								{item.label}
							</NavLink>
						))}
					</nav>
				</div>
			</header>

			{/* Sezóny dorazí až po týmu. Rám zůstává, aby se při přepnutí družstva
			    nerozsypala celá obrazovka — mění se jen obsah. */}
			<main className="mx-auto w-full max-w-3xl flex-1 px-4 pt-4 pb-28 md:pb-8">
				{isSeasonLoading ? <LoadingState /> : <Outlet />}
			</main>

			<nav
				className="border-line/60 bg-surface-1/95 fixed inset-x-0 bottom-0 z-20 border-t backdrop-blur md:hidden"
				style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}
				aria-label="Hlavní navigace"
			>
				<ul className="mx-auto flex max-w-3xl">
					{visible.map((item) => (
						<li key={item.to} className="flex-1">
							<NavLink
								to={item.to}
								className={({ isActive }) =>
									cn(
										'flex flex-col items-center gap-0.5 py-2 text-[0.6875rem] transition-colors',
										isActive ? 'text-accent' : 'text-ink-faint',
									)
								}
							>
								{({ isActive }) => (
									<>
										<item.icon className={cn('size-6', isActive && 'stroke-2')} />
										{item.label}
									</>
								)}
							</NavLink>
						</li>
					))}
				</ul>
			</nav>
		</div>
	)
}
