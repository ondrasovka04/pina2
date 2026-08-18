import type { ComponentType, ReactNode, SVGProps } from 'react'
import { useEffect, useState } from 'react'
import { Link, NavLink, Outlet } from 'react-router'

import { useCurrentUser } from '@/app/session'
import { useTeam } from '@/app/team'
import { TeamSwitcher } from '@/app/TeamSwitcher'
import { TeamLogo } from '@/components/TeamLogo'
import { CalendarIcon, ListIcon, PlusIcon, UserIcon, WalletIcon } from '@/components/ui/icons'
import { ErrorState, LoadingState } from '@/components/ui/States'
import { cn } from '@/lib/cn'
import type { Role } from '@/lib/types'

interface NavItem {
	to: string
	label: string
	icon: ComponentType<SVGProps<SVGSVGElement>>
	requires?: Role
	/** Místo ikony se v liště ukáže profilový obrázek, pokud ho uživatel má. */
	avatar?: boolean
}

const navItems: NavItem[] = [
	{ to: '/kalendar', label: 'Kalendář', icon: CalendarIcon },
	{ to: '/dluhy', label: 'Dluhy', icon: WalletIcon },
	{ to: '/zapsat', label: 'Zapsat', icon: PlusIcon, requires: 'treasurer' },
	{ to: '/sazebnik', label: 'Sazebník', icon: ListIcon },
	{ to: '/ja', label: 'Já', icon: UserIcon, avatar: true },
]

/**
 * Tvář místo ikony; při chybějícím nebo rozbitém obrázku `fallback` (iniciály by
 * mezi linkovými ikonami vypadaly cizí). `ringed` značí aktivní záložku tam, kde
 * ji obrázek nemůže vzít z barvy textu jako ikona.
 */
function NavAvatar({ src, ringed, fallback }: { src: string; ringed: boolean; fallback: ReactNode }) {
	const [failed, setFailed] = useState(false)

	useEffect(() => setFailed(false), [src])

	if (failed) return fallback

	return (
		<img
			src={src}
			alt=""
			className={cn('size-6 rounded-full object-cover', ringed && 'outline-accent outline-2 outline-offset-1')}
			onError={() => setFailed(true)}
		/>
	)
}

export function AppLayout() {
	const { team, can, isLoading, isSeasonLoading, isSeasonClosed, error } = useTeam()
	const user = useCurrentUser()

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
					<Link to="/kalendar" aria-label="Kalendář" className="shrink-0">
						<TeamLogo src={team.logoUrl} className="h-8 max-w-24" />
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
								{item.avatar === true && user.avatarUrl !== null ? (
									<span className="flex items-center gap-2">
										<NavAvatar src={user.avatarUrl} ringed={false} fallback={null} />
										{item.label}
									</span>
								) : (
									item.label
								)}
							</NavLink>
						))}
					</nav>
				</div>
			</header>

			{/* Rám zůstává při přepnutí týmu — mění se jen obsah */}
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
										{item.avatar === true && user.avatarUrl !== null ? (
											<NavAvatar
												src={user.avatarUrl}
												ringed={isActive}
												fallback={<UserIcon className={cn('size-6', isActive && 'stroke-2')} />}
											/>
										) : (
											<item.icon className={cn('size-6', isActive && 'stroke-2')} />
										)}
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
