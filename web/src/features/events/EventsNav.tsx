import { NavLink } from 'react-router'

import { cn } from '@/lib/cn'

/** Přepínač mezi kalendářem a účastí, schválně stejný na obou — dřív vedl jen jedním směrem. */
export function EventsNav() {
	return (
		<nav className="flex items-baseline gap-3" aria-label="Docházka">
			<Tab to="/kalendar">Kalendář</Tab>
			<Tab to="/dochazka">Účast</Tab>
		</nav>
	)
}

function Tab({ to, children }: { to: string; children: string }) {
	return (
		<NavLink
			to={to}
			end
			className={({ isActive }) =>
				cn('py-1 text-lg transition-colors', isActive ? 'text-ink font-semibold' : 'text-ink-muted text-base')
			}
		>
			{children}
		</NavLink>
	)
}
