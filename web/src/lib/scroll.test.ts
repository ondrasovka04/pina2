import { renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { useScrollTopOnChange } from './scroll'

const scrollTo = vi.fn()

beforeEach(() => {
	scrollTo.mockReset()
	vi.stubGlobal('scrollTo', scrollTo)
})

describe('useScrollTopOnChange', () => {
	it('při prvním vykreslení neposouvá', () => {
		// Jinak by přebilo pozici obnovenou po návratu tlačítkem zpět.
		renderHook(() => useScrollTopOnChange('compose'))

		expect(scrollTo).not.toHaveBeenCalled()
	})

	it('po přepnutí kroku vyjede nahoru', () => {
		const { rerender } = renderHook(({ step }) => useScrollTopOnChange(step), {
			initialProps: { step: 'compose' },
		})

		rerender({ step: 'review' })

		expect(scrollTo).toHaveBeenCalledWith({ top: 0 })
	})

	it('překreslení beze změny kroku neposouvá', () => {
		const { rerender } = renderHook(({ step }) => useScrollTopOnChange(step), {
			initialProps: { step: 'compose' },
		})

		rerender({ step: 'compose' })

		expect(scrollTo).not.toHaveBeenCalled()
	})

	it('posouvá při každém dalším přepnutí', () => {
		const { rerender } = renderHook(({ step }) => useScrollTopOnChange(step), {
			initialProps: { step: 'compose' },
		})

		rerender({ step: 'review' })
		rerender({ step: 'done' })

		expect(scrollTo).toHaveBeenCalledTimes(2)
	})
})
