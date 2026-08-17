import { describe, expect, it } from 'vitest'

import { formatCzk } from '@/lib/types'

describe('formatCzk', () => {
	it('nulu nikdy nevypíše se znaménkem', () => {
		// Obrazovky obracejí znaménko u zaplaceno a cesťáků; -0 by se ukázalo jako „-0 Kč".
		expect(formatCzk(-0)).toBe(formatCzk(0))
		expect(formatCzk(-0)).not.toContain('-')
	})

	it('dluh i bonus si znaménko drží', () => {
		expect(formatCzk(250)).not.toContain('-')
		expect(formatCzk(-250)).toContain('-')
	})
})
