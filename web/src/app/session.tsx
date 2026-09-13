import { useQueryClient } from '@tanstack/react-query'
import type { ReactNode } from 'react'
import { createContext, use, useCallback, useEffect, useMemo, useState } from 'react'

import { api, setAccessToken, setUnauthenticatedHandler } from '@/lib/api'
import { currentPushSubscription } from '@/lib/push'
import type { CurrentUser, LoginResponse } from '@/lib/types'

type SessionStatus = 'loading' | 'authenticated' | 'anonymous'

interface SessionValue {
	status: SessionStatus
	user: CurrentUser | null
	signIn: (email: string, password: string) => Promise<void>
	/** Heslo a jméno jsou `null`, když je pozvaný má už z jiného klubu. */
	acceptInvitation: (token: string, password: string | null, name: string | null) => Promise<void>
	/** Nové heslo z odkazu — server v odpovědi rovnou přihlašuje. */
	resetPassword: (token: string, password: string) => Promise<void>
	refreshUser: () => Promise<void>
	signOut: () => Promise<void>
}

const SessionContext = createContext<SessionValue | null>(null)

export function useSession(): SessionValue {
	const value = use(SessionContext)
	if (value === null) throw new Error('useSession musí být uvnitř <SessionProvider>')

	return value
}

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

	// Relace vypršela — synchronizuj stav bez zásahu uživatele
	useEffect(() => {
		setUnauthenticatedHandler(() => {
			setUser(null)
			setStatus('anonymous')
			queryClient.clear()
		})
	}, [queryClient])

	/**
	 * Přihlášení musí zahodit cache stejně jako odhlášení. Klíče dotazů nenesou
	 * uživatele (`['seasons', 10, 'balances']`), takže po přihlášení jiného účtu
	 * by se `staleTime` po dobu 30 s obsloužil daty předchozího — a hráč by
	 * viděl dluhy celého družstva, které mu server posílat odmítá.
	 */
	const startSession = useCallback(
		(result: LoginResponse) => {
			queryClient.clear()
			setAccessToken(result.accessToken)
			setUser(result.user)
			setStatus('authenticated')
		},
		[queryClient],
	)

	const signIn = useCallback(
		async (email: string, password: string) => {
			startSession(await api.post<LoginResponse>('/auth/login', { email, password }))
		},
		[startSession],
	)

	const acceptInvitation = useCallback(
		async (token: string, password: string | null, name: string | null) => {
			startSession(await api.post<LoginResponse>('/invitations/accept', { token, password, name }))
		},
		[startSession],
	)

	const resetPassword = useCallback(
		async (token: string, password: string) => {
			startSession(await api.post<LoginResponse>('/auth/password/reset', { token, password }))
		},
		[startSession],
	)

	const signOut = useCallback(async () => {
		try {
			const subscription = await currentPushSubscription()
			if (subscription !== null) {
				try {
					await api.post('/push/unsubscribe', { endpoint: subscription.endpoint })
				} finally {
					await subscription.unsubscribe()
				}
			}
		} catch {
			// Odběr prohlížeče se nemusí podařit zjistit; odhlášení tím neblokujeme.
		}

		try {
			await api.post('/auth/logout')
		} finally {
			// Lokální odhlášení i když server selže — pojistka pro cizí telefon
			setAccessToken(null)
			setUser(null)
			setStatus('anonymous')
			queryClient.clear()
		}
	}, [queryClient])

	const refreshUser = useCallback(async () => {
		setUser(await api.get<CurrentUser>('/me'))
	}, [])

	const value = useMemo<SessionValue>(
		() => ({ status, user, signIn, acceptInvitation, resetPassword, refreshUser, signOut }),
		[status, user, signIn, acceptInvitation, resetPassword, refreshUser, signOut],
	)

	return <SessionContext value={value}>{children}</SessionContext>
}
