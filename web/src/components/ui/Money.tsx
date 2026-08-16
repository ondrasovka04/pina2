import { cn } from '@/lib/cn'
import { formatCzk } from '@/lib/types'

/**
 * `balance` je zůstatek hráče: kladné číslo znamená dluh, a ten se má
 * červenat. `plain` je cena v sazebníku nebo částka jednoho zápisu —
 * tam je pokuta normální stav a barví se jen záporná částka, tedy bonus.
 */
type Tone = 'plain' | 'balance'

interface MoneyProps {
	czk: number
	tone?: Tone
	className?: string
}

function toneClass(czk: number, tone: Tone): string {
	if (czk < 0) return 'text-bonus'
	if (tone === 'balance') return czk > 0 ? 'text-debt' : 'text-ink-faint'

	return 'text-ink'
}

export function Money({ czk, tone = 'plain', className }: MoneyProps) {
	return <span className={cn('tabular whitespace-nowrap', toneClass(czk, tone), className)}>{formatCzk(czk)}</span>
}
