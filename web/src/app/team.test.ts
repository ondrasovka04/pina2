import { describe, expect, it } from 'vitest'

import { homePath } from '@/app/team'

describe('domovská cesta družstva', () => {
	it('vede podle zapnutí docházky na kalendář nebo dluhy', () => {
		expect(homePath(true)).toBe('/kalendar')
		expect(homePath(false)).toBe('/dluhy')
	})
})
