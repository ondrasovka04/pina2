import { describe, expect, it } from 'vitest'

import { formatPhone } from './phone'

describe('formatPhone', () => {
	it('rozdělí české číslo pro čitelné zobrazení', () => {
		expect(formatPhone('+420777123456')).toBe('+420 777 123 456')
	})

	it('nepřepisuje neznámý formát', () => {
		expect(formatPhone('+421901123456')).toBe('+421901123456')
	})
})
