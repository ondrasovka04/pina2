import { describe, expect, it } from 'vitest'

import { players, records } from './plural'

describe('records', () => {
	it('používá všechny tři české tvary', () => {
		expect(records(1)).toBe('1 zápis')
		expect(records(3)).toBe('3 zápisy')
		expect(records(5)).toBe('5 zápisů')
		expect(records(21)).toBe('21 zápisů')
	})

	it('nulu říká slovem, ne jako „0 zápisů"', () => {
		expect(records(0)).toBe('bez zápisu')
	})
})

describe('players', () => {
	it('skloňuje hráče', () => {
		expect(players(1)).toBe('1 hráč')
		expect(players(4)).toBe('4 hráči')
		expect(players(9)).toBe('9 hráčů')
	})
})
