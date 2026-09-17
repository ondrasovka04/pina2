// Access token v paměti (ne localStorage) — Refresh cookie drží refresh token
export interface ApiErrorBody {
	error: {
		code: string
		message: string
		details?: Record<string, unknown>
	}
}

export class ApiError extends Error {
	constructor(
		readonly status: number,
		readonly code: string,
		message: string,
		readonly details?: Record<string, unknown>,
	) {
		super(message)
		this.name = 'ApiError'
	}

	get field(): string | undefined {
		const field = this.details?.['field']
		return typeof field === 'string' ? field : undefined
	}
}

let accessToken: string | null = null
let activeSupportTeamId: number | null = null

export function setSupportTeamId(teamId: number | null): void {
	activeSupportTeamId = teamId
}
let onUnauthenticated: (() => void) | null = null

export function setAccessToken(token: string | null): void {
	accessToken = token
	if (token === null) {
		activeSupportTeamId = null
	}
}

export function setUnauthenticatedHandler(handler: () => void): void {
	onUnauthenticated = handler
}

interface RequestOptions {
	method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE'
	body?: unknown
	signal?: AbortSignal
	skipRefresh?: boolean
	supportTeamId?: number | null
}

// Jedinou aktualizaci tokenu — ostatní čekají na stejný výsledek
let refreshInFlight: Promise<boolean> | null = null

async function refreshAccessToken(): Promise<boolean> {
	refreshInFlight ??= (async () => {
		try {
			const response = await fetch('/api/v1/auth/refresh', {
				method: 'POST',
				credentials: 'include',
			})

			if (!response.ok) {
				return false
			}

			const data = (await response.json()) as { accessToken: string }
			accessToken = data.accessToken
			return true
		} catch {
			return false
		} finally {
			refreshInFlight = null
		}
	})()

	return refreshInFlight
}

export async function apiRequest<T>(path: string, options: RequestOptions = {}): Promise<T> {
	const { method = 'GET', body, signal, skipRefresh = false, supportTeamId = activeSupportTeamId } = options

	const headers: Record<string, string> = {}
	if (supportTeamId !== null) {
		headers['X-Support-Team'] = String(supportTeamId)
	}
	if (accessToken !== null) {
		headers['Authorization'] = `Bearer ${accessToken}`
	}
	if (body !== undefined) {
		headers['Content-Type'] = 'application/json'
	}

	const init: RequestInit = { method, headers, credentials: 'include' }
	if (body !== undefined) {
		init.body = JSON.stringify(body)
	}
	if (signal !== undefined) {
		init.signal = signal
	}

	const response = await fetch(path.startsWith('/api') ? path : `/api/v1${path}`, init)

	// Vypršelý token: obnovit a zopakovat. Jen jednou, jinak hrozí smyčka.
	if (response.status === 401 && !skipRefresh) {
		if (await refreshAccessToken()) {
			return apiRequest<T>(path, { ...options, skipRefresh: true, supportTeamId })
		}

		setAccessToken(null)
		onUnauthenticated?.()
	}

	if (response.status === 204) {
		return undefined as T
	}

	const text = await response.text()
	const payload: unknown = text === '' ? null : JSON.parse(text)

	if (!response.ok) {
		const error = (payload as ApiErrorBody | null)?.error
		throw new ApiError(
			response.status,
			error?.code ?? 'UNKNOWN',
			error?.message ?? 'Něco se pokazilo. Zkuste to prosím znovu.',
			error?.details,
		)
	}

	return payload as T
}

export const api = {
	get: <T>(path: string, signal?: AbortSignal) => apiRequest<T>(path, signal === undefined ? {} : { signal }),
	post: <T>(path: string, body?: unknown) => apiRequest<T>(path, { method: 'POST', body }),
	put: <T>(path: string, body?: unknown) => apiRequest<T>(path, { method: 'PUT', body }),
	patch: <T>(path: string, body?: unknown) => apiRequest<T>(path, { method: 'PATCH', body }),
	delete: <T>(path: string) => apiRequest<T>(path, { method: 'DELETE' }),
}
