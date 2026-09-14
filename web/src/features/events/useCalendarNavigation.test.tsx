import { act, fireEvent, renderHook } from '@testing-library/react'
import { StrictMode } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { useCalendarNavigation } from './useCalendarNavigation'

const key = 'pina.calendar:1:10'
const snapshot = { view: 'grid', month: '2099-11', period: 'past', scrollY: 1400 }
const scrollTo = vi.fn((options: ScrollToOptions) => vi.stubGlobal('scrollY', options.top ?? 0))

beforeEach(() => {
	vi.restoreAllMocks()
	sessionStorage.clear()
	scrollTo.mockClear()
	vi.stubGlobal('scrollTo', scrollTo)
	vi.stubGlobal('scrollY', 0)
})

function scroll(y: number) {
	vi.stubGlobal('scrollY', y)
	fireEvent.scroll(window)
}

describe('Paměť kalendáře', () => {
	it('uloží poslední pozici, měsíc a období při odchodu', () => {
		const { result, unmount } = renderHook(() => useCalendarNavigation(1, 10, true))
		act(() => {
			result.current.setView('grid')
			result.current.setMonth('2099-11')
			result.current.setPeriod('past')
		})
		scroll(1400)
		expect(sessionStorage.getItem(key)).toBeNull()
		// Router při odchodu už mohl posunout novou stránku nahoru.
		vi.stubGlobal('scrollY', 0)
		unmount()
		expect(JSON.parse(sessionStorage.getItem(key)!)).toEqual(snapshot)

		const restored = renderHook(() => useCalendarNavigation(1, 10, true))
		expect(restored.result.current).toMatchObject({ view: 'grid', month: '2099-11', period: 'past' })
		expect(window.scrollY).toBe(1400)
	})

	it('s obnovením počká na načtený seznam a při překreslení ho neopakuje', () => {
		sessionStorage.setItem(key, JSON.stringify(snapshot))
		const { rerender } = renderHook(({ ready }) => useCalendarNavigation(1, 10, ready), {
			initialProps: { ready: false },
		})
		expect(scrollTo).not.toHaveBeenCalled()
		rerender({ ready: true })
		expect(scrollTo).toHaveBeenCalledWith({ top: 1400, behavior: 'instant' })
		scroll(1700)
		rerender({ ready: true })
		expect(scrollTo).toHaveBeenCalledTimes(1)
		expect(window.scrollY).toBe(1700)
	})

	it('na první návštěvě nepřebije posun routeru', () => {
		renderHook(() => useCalendarNavigation(1, 10, true))
		expect(scrollTo).not.toHaveBeenCalled()
	})

	it('během načítání nezničí uloženou pozici ani při opětovném odchodu', () => {
		sessionStorage.setItem(key, JSON.stringify(snapshot))
		const { unmount } = renderHook(() => useCalendarNavigation(1, 10, false))
		unmount()
		expect(JSON.parse(sessionStorage.getItem(key)!)).toEqual(snapshot)
	})

	it('odděluje sezóny a přihlášené uživatele', () => {
		sessionStorage.setItem(key, JSON.stringify(snapshot))
		const anotherSeason = renderHook(() => useCalendarNavigation(1, 20, true))
		expect(anotherSeason.result.current).toMatchObject({ month: null, period: 'upcoming' })
		anotherSeason.unmount()
		const anotherUser = renderHook(() => useCalendarNavigation(2, 10, true))
		expect(anotherUser.result.current).toMatchObject({ month: null, period: 'upcoming' })
		expect(scrollTo).not.toHaveBeenCalled()
		expect(JSON.parse(sessionStorage.getItem(key)!)).toEqual(snapshot)
	})

	it('uloží aktuální stav také před obnovením stránky', () => {
		renderHook(() => useCalendarNavigation(1, 10, true))
		scroll(800)
		fireEvent(window, new Event('pagehide'))
		expect(JSON.parse(sessionStorage.getItem(key)!)).toMatchObject({ scrollY: 800 })
	})

	it('obnoví pozici i při opakovaných efektech ve StrictMode', () => {
		sessionStorage.setItem(key, JSON.stringify(snapshot))
		renderHook(() => useCalendarNavigation(1, 10, true), { wrapper: StrictMode })
		expect(window.scrollY).toBe(1400)
	})

	it.each([
		'{',
		'null',
		JSON.stringify({ ...snapshot, scrollY: -1 }),
		JSON.stringify({ ...snapshot, month: '2099-99' }),
	])('ustojí poškozený uložený stav: %s', (value) => {
		sessionStorage.setItem(key, value)
		const { result } = renderHook(() => useCalendarNavigation(1, 10, true))
		expect(result.current).toMatchObject({ view: 'list', month: null, period: 'upcoming' })
		expect(scrollTo).not.toHaveBeenCalled()
	})

	it('ustojí zakázané úložiště', () => {
		vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
			throw new Error('Zakázáno')
		})
		vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
			throw new Error('Zakázáno')
		})
		const { result, unmount } = renderHook(() => useCalendarNavigation(1, 10, true))
		act(() => result.current.setView('grid'))
		expect(result.current.view).toBe('grid')
		expect(() => unmount()).not.toThrow()
	})
})
