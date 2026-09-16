// Přetahování v seznamu — geometrie se ручně testuje, drží se mimo komponentu
export function targetIndex(midpoints: readonly number[], pageY: number): number {
	const crossed = midpoints.findIndex((midpoint) => pageY < midpoint)

	return crossed === -1 ? Math.max(midpoints.length - 1, 0) : crossed
}

// Posun řádku — sousedé se posune o jeho výšku, zbytek stojí
export function shift(index: number, from: number, to: number, height: number): number {
	if (from < to && index > from && index <= to) {
		return -height
	}
	if (from > to && index >= to && index < from) {
		return height
	}

	return 0
}

export function moveItem<T>(items: readonly T[], from: number, to: number): T[] {
	if (from === to || from < 0 || from >= items.length || to < 0 || to >= items.length) {
		return [...items]
	}

	const next = [...items]
	const [moved] = next.splice(from, 1)
	if (moved === undefined) {
		return [...items]
	}

	next.splice(to, 0, moved)

	return next
}
