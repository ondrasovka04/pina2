import { describe, expect, it } from 'vitest'

import { moveItem, shift, targetIndex } from './reorder'

// Pět řádků, středy na 120, 160, 200, 240, 280.
const midpoints = [120, 160, 200, 240, 280]

describe('targetIndex', () => {
	it('vrátí řádek, nad kterým prst je', () => {
		expect(targetIndex(midpoints, 110)).toBe(0)
		expect(targetIndex(midpoints, 150)).toBe(1)
		expect(targetIndex(midpoints, 210)).toBe(3)
	})

	// Chyba: přes jednu pozici se nedalo dostat.
	it('dotáhne položku přes celý seznam, ne jen o jedno místo', () => {
		expect(targetIndex(midpoints, 999)).toBe(4)
		expect(targetIndex(midpoints, 0)).toBe(0)
	})

	it('u prázdného seznamu nespadne pod nulu', () => {
		expect(targetIndex([], 50)).toBe(0)
	})
})

describe('shift', () => {
	it('při tažení dolů uhnou řádky mezi tím nahoru', () => {
		expect(shift(1, 0, 3, 40)).toBe(-40)
		expect(shift(3, 0, 3, 40)).toBe(-40)
		expect(shift(4, 0, 3, 40)).toBe(0)
	})

	it('při tažení nahoru uhnou dolů', () => {
		expect(shift(1, 3, 1, 40)).toBe(40)
		expect(shift(2, 3, 1, 40)).toBe(40)
		expect(shift(0, 3, 1, 40)).toBe(0)
	})

	it('bez změny cíle nikdo neuhýbá', () => {
		expect(shift(2, 2, 2, 40)).toBe(0)
	})
})

describe('moveItem', () => {
	const items = ['a', 'b', 'c', 'd']

	it('přesune prvek dopředu i dozadu', () => {
		expect(moveItem(items, 0, 2)).toEqual(['b', 'c', 'a', 'd'])
		expect(moveItem(items, 3, 0)).toEqual(['d', 'a', 'b', 'c'])
	})

	it('nemění vstupní pole', () => {
		moveItem(items, 0, 3)

		expect(items).toEqual(['a', 'b', 'c', 'd'])
	})

	it('mimo rozsah vrátí kopii beze změny', () => {
		expect(moveItem(items, 0, 9)).toEqual(items)
		expect(moveItem(items, -1, 1)).toEqual(items)
	})
})
