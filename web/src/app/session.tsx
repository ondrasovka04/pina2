import { useQueryClient } from '@tanstack/react-query'
import type { ReactNode } from 'react'
import { createContext, use, useCallback, useEffect, useMemo, useState } from 'react'

import { api, setAccessToken, setUnauthenticatedHandler } from '@/lib/api'
import type { CurrentUser, LoginResponse } from '@/lib/types'

type SessionStatus = 'loading' | 'authenticated' | 'anonymous'

interface SessionValue {
	status: SessionStatus
	user: CurrentUser | null
	signIn: (email: string, password: string) => Promise<void>
	signOut: () => Promise<void>
}

const SessionContext = createContext<SessionValue | null>(null)

export function useSession(): SessionValue {
	const value = use(SessionContext)
	if (value === null) throw new Error('useSession musí být uvnitř <SessionProvider>')

	return value
}

/** Přihlášený uživatel na obrazovkách za bránou — tam už `null` nastat nemůže. */
export function useCurrentUser(): CurrentUser {
	const { user } = useSession()
	if (user === null) throw new Error('useCurrentUser mimo přihlášenou část aplikace')

	return user
}

export function SessionProvider({ children }: { children: ReactNode }) {
	const queryClient = useQueryClient()
	const [user, setUser] = useState<CurrentUser | null>(null)
	const [status, setStatus] = useState<SessionStatus>('loading')

	/**
	 * Po obnovení stránky nemáme access token v paměti, zato může být platná
	 * refresh cookie. Stačí se zeptat na `/me` — klient si při 401 sám sáhne
	 * pro nový token a požadavek zopakuje. Když ani to neprojde, jsme odhlášení.
	 */
	useEffect(() => {
		let cancelled = false

		void api
			.get<CurrentUser>('/me')
			.then((me) => {
				if (cancelled) return
				setUser(me)
				setStatus('authenticated')
			})
			.catch(() => {
				if (cancelled) return
				setStatus('anonymous')
			})

		return () => {
			cancelled = true
		}
	}, [])

	// Vypršelá relace uprostřed práce: stav se srovná i bez zásahu uživatele.
	useEffect(() => {
		setUnauthenticatedHandler(() => {
			setUser(null)
			setStatus('anonymous')
			queryClient.clear()
		})
	}, [queryClient])

	const signIn = useCallback(async (email: string, password: string) => {
		const result = await api.post<LoginResponse>('/auth/login', { email, password })

		setAccessToken(result.accessToken)
		setUser(result.user)
		setStatus('authenticated')
	}, [])

	const signOut = useCallback(async () => {
		try {
			await api.post('/auth/logout')
		} finally {
			// I když odhlášení na serveru selže, lokálně relaci zahodíme —
			// jinak by uživatel zůstal viset přihlášený na cizím telefonu.
			setAccessToken(null)
			setUser(null)
			setStatus('anonymous')
			queryClient.clear()
		}
	}, [queryClient])

	const value = useMemo<SessionValue>(() => ({ status, user, signIn, signOut }), [status, user, signIn, signOut])

	return <SessionContext value={value}>{children}</SessionContext>
}
