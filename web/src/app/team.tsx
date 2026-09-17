import { useQueryClient } from '@tanstack/react-query'
import type { ReactNode } from 'react'
import { createContext, use, useCallback, useEffect, useMemo, useState } from 'react'

import { setSupportTeamId as setApiSupportTeamId } from '@/lib/api'
import { supportTeamQuery, useSeasons, useSupportTeam, useTeams } from '@/lib/queries'
import type { Role, Season, TeamSummary } from '@/lib/types'
import { atLeast } from '@/lib/types'

// Vybrané družstvo a sezóna — role se mezi nimi liší
interface TeamValue {
	teams: TeamSummary[]
	team: TeamSummary | null
	seasons: Season[]
	season: Season | null
	seasonId: number | null
	isSeasonClosed: boolean
	usesAttendance: boolean
	role: Role | null
	can: (required: Role) => boolean
	selectTeam: (teamId: number) => void
	selectSeason: (seasonId: number) => void
	isSupporting: boolean
	startSupport: (teamId: number) => Promise<void>
	stopSupport: () => void
	isLoading: boolean
	isSeasonLoading: boolean
	error: Error | null
}

const TeamContext = createContext<TeamValue | null>(null)

export function useTeam(): TeamValue {
	const value = use(TeamContext)
	if (value === null) {
		throw new Error('useTeam musí být uvnitř <TeamProvider>')
	}

	return value
}

const STORAGE_KEY = 'pina.teamId'

export function homePath(usesAttendance: boolean): '/kalendar' | '/dluhy' {
	return usesAttendance ? '/kalendar' : '/dluhy'
}

function storedTeamId(): number | null {
	try {
		const raw = localStorage.getItem(STORAGE_KEY)
		const id = raw === null ? Number.NaN : Number.parseInt(raw, 10)

		return Number.isInteger(id) ? id : null
	} catch {
		// Privátní režim v Safari umí localStorage zakázat; výběr pak jen nepřežije reload.
		return null
	}
}

export function TeamProvider({ children }: { children: ReactNode }) {
	const queryClient = useQueryClient()
	const [supportTeamId, setSupportTeamId] = useState<number | null>(null)
	const supportQuery = useSupportTeam(supportTeamId)
	const teamsQuery = useTeams()
	const [preferredTeamId, setPreferredTeamId] = useState<number | null>(storedTeamId)

	const teams = useMemo(() => teamsQuery.data ?? [], [teamsQuery.data])

	// Uložený tým nemusí existovat — padáme na první nearchivovaný
	const team = useMemo(() => {
		if (supportTeamId !== null) {
			return supportQuery.data ?? null
		}
		const preferred = teams.find((item) => item.id === preferredTeamId)
		if (preferred !== undefined) {
			return preferred
		}

		return teams.find((item) => !item.archived) ?? teams[0] ?? null
	}, [teams, preferredTeamId, supportTeamId, supportQuery.data])

	useEffect(() => () => setApiSupportTeamId(null), [])

	const stopSupport = useCallback(() => {
		if (supportTeamId === null) {
			return
		}
		setApiSupportTeamId(null)
		setSupportTeamId(null)
		void queryClient.cancelQueries()
		queryClient.clear()
	}, [queryClient, supportTeamId])

	const startSupport = useCallback(
		async (teamId: number) => {
			const selected = await queryClient.fetchQuery(supportTeamQuery(teamId))
			await queryClient.cancelQueries()
			queryClient.clear()
			setApiSupportTeamId(teamId)
			queryClient.setQueryData(supportTeamQuery(teamId).queryKey, selected)
			setSupportTeamId(teamId)
		},
		[queryClient],
	)

	const seasonsQuery = useSeasons(team?.id ?? null)
	const seasons = useMemo(() => seasonsQuery.data ?? [], [seasonsQuery.data])

	// Volba sezóny se pamatuje pro každý tým zvlášť
	const [seasonByTeam, setSeasonByTeam] = useState<Record<number, number>>({})

	const season = useMemo(() => {
		const chosen = team === null ? undefined : seasons.find((item) => item.id === seasonByTeam[team.id])

		return chosen ?? seasons.find((item) => item.isCurrent) ?? seasons[0] ?? null
	}, [seasons, seasonByTeam, team])

	const selectTeam = useCallback(
		(teamId: number) => {
			stopSupport()
			setPreferredTeamId(teamId)
			try {
				localStorage.setItem(STORAGE_KEY, String(teamId))
			} catch {
				// Neuložilo se — nevadí, výběr platí do konce relace.
			}
		},
		[stopSupport],
	)

	const selectSeason = useCallback(
		(seasonId: number) => {
			if (team === null) {
				return
			}

			setSeasonByTeam((current) => ({ ...current, [team.id]: seasonId }))
		},
		[team],
	)

	const role = team?.role ?? null

	const value = useMemo<TeamValue>(
		() => ({
			teams,
			team,
			seasons,
			season,
			seasonId: season?.id ?? null,
			isSeasonClosed: season !== null && season.closedAt !== null,
			usesAttendance: team?.attendanceEnabled ?? true,
			role,
			can: (required: Role) => atLeast(role ?? undefined, required),
			selectTeam,
			selectSeason,
			isSupporting: supportTeamId !== null,
			startSupport,
			stopSupport,
			isLoading: teamsQuery.isLoading || supportQuery.isLoading,
			isSeasonLoading: seasonsQuery.isLoading,
			error: supportQuery.error ?? teamsQuery.error,
		}),
		[
			teams,
			team,
			seasons,
			season,
			role,
			selectTeam,
			selectSeason,
			supportTeamId,
			startSupport,
			stopSupport,
			supportQuery.isLoading,
			supportQuery.error,
			teamsQuery.isLoading,
			teamsQuery.error,
			seasonsQuery.isLoading,
		],
	)

	return <TeamContext value={value}>{children}</TeamContext>
}
