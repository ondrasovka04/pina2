import type { BalanceList, BalancePeriod, BalanceSums, MemberBalance, PeriodKey } from '@/lib/types'

/**
 * Volba pololetí na obrazovkách peněz. Rozdělení je **jen podle data** — sezóna
 * se nikde nezamyká, takže lednová platba spadne do druhého pololetí i tehdy,
 * když měla zaplatit podzim. Kdo v tom hledá uzávěrku, hledá špatnou věc.
 */

/** Součty za pololetí, nebo `null` když se má vzít celá sezóna. */
export function sumsFor(
	source: { halves: { first: BalanceSums; second: BalanceSums } | null },
	period: PeriodKey,
): BalanceSums | null {
	if (period === 'all' || source.halves === null) {
		return null
	}

	return period === 'first' ? source.halves.first : source.halves.second
}

/** Zůstatek hráče za vybrané období; bez rozpadu padá zpátky na celou sezónu. */
export function memberBalance(member: MemberBalance, period: PeriodKey): number {
	return sumsFor(member, period)?.balanceCzk ?? member.balanceCzk
}

/** Počet zápisů hráče za vybrané období. */
export function memberRecordCount(member: MemberBalance, period: PeriodKey): number {
	return sumsFor(member, period)?.recordCount ?? member.recordCount
}

/** Součty za celé družstvo pro vybrané období. */
export function teamSums(data: BalanceList, period: PeriodKey): BalanceSums {
	return sumsFor(data, period) ?? data.totals
}

/**
 * Datum patří do období. Hranice `from`/`to` jsou včetně, protože je server
 * posílá jako skutečné krajní dny období, ne jako polootevřený interval.
 */
export function inPeriod(date: string, period: BalancePeriod | undefined): boolean {
	if (period === undefined || period.key === 'all') {
		return true
	}

	return date >= period.from && date <= period.to
}

/** Datované položky (platby, cesťáky) zúžené na vybrané období. */
export function itemsInPeriod<T>(items: T[], dateOf: (item: T) => string, period: BalancePeriod | undefined): T[] {
	if (period === undefined || period.key === 'all') {
		return items
	}

	return items.filter((item) => inPeriod(dateOf(item), period))
}

export function periodByKey(periods: BalancePeriod[], key: PeriodKey): BalancePeriod | undefined {
	return periods.find((period) => period.key === key)
}
