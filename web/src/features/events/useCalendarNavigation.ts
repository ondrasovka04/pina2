import { useLayoutEffect, useRef, useState } from 'react'

export type CalendarView = 'list' | 'grid'
export type CalendarPeriod = 'upcoming' | 'past'

interface CalendarSelection {
	view: CalendarView
	month: string | null
	period: CalendarPeriod
}

interface CalendarSnapshot extends CalendarSelection {
	scrollY: number
}

const VIEW_KEY = 'pina.calendarView'

function storedView(): CalendarView {
	try {
		return localStorage.getItem(VIEW_KEY) === 'grid' ? 'grid' : 'list'
	} catch {
		return 'list'
	}
}

function readSnapshot(key: string): CalendarSnapshot | null {
	try {
		const value: unknown = JSON.parse(sessionStorage.getItem(key) ?? 'null')
		if (
			typeof value !== 'object' ||
			value === null ||
			!('view' in value) ||
			(value.view !== 'list' && value.view !== 'grid') ||
			!('period' in value) ||
			(value.period !== 'upcoming' && value.period !== 'past') ||
			!('month' in value) ||
			(value.month !== null && (typeof value.month !== 'string' || !/^\d{4}-(0[1-9]|1[0-2])$/.test(value.month))) ||
			!('scrollY' in value) ||
			typeof value.scrollY !== 'number' ||
			!Number.isFinite(value.scrollY) ||
			value.scrollY < 0
		)
			return null

		return { view: value.view, period: value.period, month: value.month, scrollY: value.scrollY }
	} catch {
		return null
	}
}

/** Stav jedné návštěvy kalendáře; klíč komponenty musí oddělovat uživatele a sezóny. */
export function useCalendarNavigation(userId: number, seasonId: number, ready: boolean) {
	const key = `pina.calendar:${userId}:${seasonId}`
	const [snapshot] = useState(() => readSnapshot(key))
	const [selection, setSelection] = useState<CalendarSelection>(
		() =>
			snapshot ?? {
				view: storedView(),
				month: null,
				period: 'upcoming',
			},
	)
	const committedSelection = useRef(selection)
	const scrollY = useRef<number | null>(snapshot?.scrollY ?? null)

	useLayoutEffect(() => {
		committedSelection.current = selection
	}, [selection])

	useLayoutEffect(() => {
		// Router může mezitím ukázat krátký stav načítání. Obnovujeme až nad
		// hotovým seznamem, jinak prohlížeč ořízne uloženou pozici k nule.
		if (!ready) return
		if (scrollY.current !== null) window.scrollTo({ top: scrollY.current, behavior: 'instant' })
		const rememberScroll = () => {
			scrollY.current = window.scrollY
		}
		rememberScroll()
		const persist = () => {
			try {
				sessionStorage.setItem(key, JSON.stringify({ ...committedSelection.current, scrollY: scrollY.current }))
			} catch {
				// Zakázané úložiště nesmí bránit prohlížení akcí.
			}
		}
		const onPageHide = () => {
			rememberScroll()
			persist()
		}
		window.addEventListener('scroll', rememberScroll, { passive: true })
		window.addEventListener('pagehide', onPageHide)
		return () => {
			// Čteme poslední scroll událost, ne pozici detailu, kterou už mohl
			// router při přechodu vynulovat. Do úložiště nepíšeme při každém posunu.
			persist()
			window.removeEventListener('scroll', rememberScroll)
			window.removeEventListener('pagehide', onPageHide)
		}
	}, [key, ready])

	return {
		...selection,
		setView: (view: CalendarView) => {
			setSelection((current) => ({ ...current, view }))
			try {
				localStorage.setItem(VIEW_KEY, view)
			} catch {
				/* Volba platí i bez úložiště. */
			}
		},
		setMonth: (month: string) => setSelection((current) => ({ ...current, month })),
		setPeriod: (period: CalendarPeriod) => setSelection((current) => ({ ...current, period })),
	}
}
