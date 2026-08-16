import { describe, expect, it } from 'vitest'

import { matches, normalize } from './text'

describe('normalize', () => {
	it('shodí diakritiku i velikost písmen', () => {
		expect(normalize('Šršeň')).toBe('srsen')
		expect(normalize('  Pozdní Příchod ')).toBe('pozdni prichod')
	})
})

describe('matches', () => {
	it('najde jméno psané bez háčků', () => {
		expect(matches('Šoty', 'soty')).toBe(true)
		expect(matches('Kryštof', 'krystof')).toBe(true)
	})

	it('hledá i uprostřed názvu', () => {
		expect(matches('Pozdní příchod na trénink', 'trenink')).toBe(true)
	})

	it('prázdný dotaz projde vždy', () => {
		expect(matches('cokoli', '   ')).toBe(true)
	})

	it('nenajde, co tam není', () => {
		expect(matches('Žlutá karta', 'cervena')).toBe(false)
	})
})
