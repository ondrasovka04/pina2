/**
 * Výpočty za přetahováním v seznamu. Držené mimo komponentu schválně — právě
 * tahle geometrie se dřív pletla a ručně se testuje mizerně.
 *
 * Souřadnice jsou dokumentové (`clientY + scrollY`), aby výpočet přežil
 * odrolování stránky během tažení.
 */

/** Pozice, kam řádek spadne, když se prst zvedne nad `pageY`. */
export function targetIndex(midpoints: readonly number[], pageY: number): number {
	const crossed = midpoints.findIndex((midpoint) => pageY < midpoint)

	return crossed === -1 ? Math.max(midpoints.length - 1, 0) : crossed
}

/**
 * O kolik pixelů uhnout řádek na pozici `index`, aby se uvolnilo místo tam,
 * kam míří tažený řádek. Sousedi se posouvají o jeho výšku, zbytek stojí.
 */
export function shift(index: number, from: number, to: number, height: number): number {
	if (from < to && index > from && index <= to) return -height
	if (from > to && index >= to && index < from) return height

	return 0
}

/** Přesun prvku v poli. Mimo rozsah nebo bez změny vrací původní pole. */
export function moveItem<T>(items: readonly T[], from: number, to: number): T[] {
	if (from === to || from < 0 || from >= items.length || to < 0 || to >= items.length) {
		return [...items]
	}

	const next = [...items]
	const [moved] = next.splice(from, 1)
	if (moved === undefined) return [...items]

	next.splice(to, 0, moved)

	return next
}
