import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, renderHook, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { TeamProvider, useTeam } from '@/app/team'
import { api, setAccessToken } from '@/lib/api'
import type { TeamSummary } from '@/lib/types'

const ownTeam: TeamSummary = {
	id: 1,
	name: 'Moje družstvo',
	clubId: 1,
	clubName: 'Můj klub',
	logoUrl: null,
	membershipId: 10,
	role: 'player',
	archived: false,
	attendanceEnabled: true,
	travelEnabled: false,
	currentSeason: null,
}
const foreignTeam: TeamSummary = {
	...ownTeam,
	id: 2,
	name: 'Cizí družstvo',
	clubId: 2,
	membershipId: null,
	role: 'admin',
}

describe('přepínání podpory bez členství', () => {
	let queryClient: QueryClient
	let requests: { path: string; support: string | null }[]
	let rejectSupport: boolean
	let availableTeams: TeamSummary[]

	beforeEach(() => {
		requests = []
		rejectSupport = false
		availableTeams = [ownTeam]
		queryClient = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: 30_000 } } })
		vi.stubGlobal(
			'fetch',
			vi.fn<typeof fetch>((input, init) => {
				const path = String(input).replace('/api/v1', '')
				requests.push({ path, support: new Headers(init?.headers).get('X-Support-Team') })
				if (path === '/me/teams') {
					return Promise.resolve(Response.json({ teams: availableTeams }))
				}
				if (path === '/admin/teams/2/support') {
					return Promise.resolve(
						rejectSupport
							? Response.json({ error: { code: 'FORBIDDEN', message: 'Nemáte oprávnění.' } }, { status: 403 })
							: Response.json(foreignTeam),
					)
				}
				if (path.endsWith('/seasons')) {
					return Promise.resolve(Response.json({ seasons: [] }))
				}
				return Promise.resolve(Response.json({ ok: true }))
			}),
		)
	})

	afterEach(() => {
		queryClient.clear()
		setAccessToken(null)
		vi.unstubAllGlobals()
	})

	function wrapper({ children }: { children: ReactNode }) {
		return (
			<QueryClientProvider client={queryClient}>
				<TeamProvider>{children}</TeamProvider>
			</QueryClientProvider>
		)
	}

	it('dá admina cizímu týmu bez přidání do vlastních týmů a při návratu smaže citlivou cache', async () => {
		const { result } = renderHook(useTeam, { wrapper })
		await waitFor(() => expect(result.current.team?.role).toBe('player'))
		queryClient.setQueryData(['soukromá-data'], 'původní pohled')
		await act(() => result.current.startSupport(2))
		await waitFor(() => expect(result.current.isLoading).toBe(false))
		expect(result.current.team).toEqual(foreignTeam)
		expect(result.current.can('admin')).toBe(true)
		expect(result.current.teams).toEqual([ownTeam])
		expect(queryClient.getQueryData(['soukromá-data'])).toBeUndefined()
		await api.get('/teams/2')
		expect(requests.at(-1)).toEqual({ path: '/teams/2', support: '2' })

		queryClient.setQueryData(['cizí-dluhy'], 'citlivá data')
		act(() => result.current.stopSupport())
		await waitFor(() => expect(result.current.team?.role).toBe('player'))
		expect(result.current.can('admin')).toBe(false)
		expect(result.current.isSupporting).toBe(false)
		expect(queryClient.getQueryData(['cizí-dluhy'])).toBeUndefined()
		await api.get('/teams/1')
		expect(requests.at(-1)).toEqual({ path: '/teams/1', support: null })
	})

	it('odmítnutý vstup zachová původní roli, družstvo i požadavky bez podpory', async () => {
		rejectSupport = true
		const { result } = renderHook(useTeam, { wrapper })
		await waitFor(() => expect(result.current.team?.id).toBe(1))
		await act(async () => {
			await expect(result.current.startSupport(2)).rejects.toThrow('Nemáte oprávnění.')
		})
		expect(result.current.team).toEqual(ownTeam)
		expect(result.current.isSupporting).toBe(false)
		await api.get('/teams/1')
		expect(requests.at(-1)?.support).toBeNull()
	})

	it('funguje i pro správce bez jediného vlastního družstva', async () => {
		availableTeams = []
		const { result } = renderHook(useTeam, { wrapper })
		await waitFor(() => expect(result.current.isLoading).toBe(false))
		await act(() => result.current.startSupport(2))
		await waitFor(() => expect(result.current.isLoading).toBe(false))
		expect(result.current.team).toEqual(foreignTeam)
		expect(result.current.teams).toEqual([])
		act(() => result.current.selectTeam(1))
		await waitFor(() => expect(result.current.isLoading).toBe(false))
		expect(result.current.isSupporting).toBe(false)
		expect(result.current.team).toBeNull()
	})
})
