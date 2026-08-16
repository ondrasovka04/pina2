import { useMutation, useQueries, useQuery, useQueryClient } from '@tanstack/react-query'

import { api } from '@/lib/api'
import type {
	BalanceList,
	BatchInput,
	BatchSummary,
	OffenceCategory,
	OffenceType,
	RecordList,
	RosterEntry,
	Season,
	TeamMember,
	TeamSummary,
} from '@/lib/types'

/**
 * Klíče na jednom místě, aby invalidace po zápisu trefila přesně to, co se
 * změnilo. Struktura kopíruje cesty API, takže `['seasons', id]` zneplatní
 * všechno, co k sezóně patří.
 */
export const queryKeys = {
	teams: ['teams'] as const,
	seasons: (teamId: number) => ['teams', teamId, 'seasons'] as const,
	season: (seasonId: number) => ['seasons', seasonId] as const,
	balances: (seasonId: number) => ['seasons', seasonId, 'balances'] as const,
	offenceTypes: (seasonId: number) => ['seasons', seasonId, 'offence-types'] as const,
	records: (seasonId: number, membershipId?: number) =>
		['seasons', seasonId, 'records', membershipId ?? 'all'] as const,
	batch: (batchId: number) => ['batches', batchId] as const,
	members: (teamId: number) => ['teams', teamId, 'members'] as const,
}

/**
 * Seznamy vrací API zabalené do objektu s jednou položkou (`{ teams: [...] }`),
 * aby šlo časem přidat stránkování bez rozbití klienta. Hooky to rozbalují,
 * takže komponenty dostanou rovnou pole — obálka je věc protokolu, ne UI.
 */
export function useTeams() {
	return useQuery({
		queryKey: queryKeys.teams,
		queryFn: async ({ signal }) => (await api.get<{ teams: TeamSummary[] }>('/me/teams', signal)).teams,
		// Zařazení do týmu se mění párkrát za sezónu; není důvod se ptát pořád.
		staleTime: 5 * 60_000,
	})
}

export function useSeasons(teamId: number | null) {
	return useQuery({
		queryKey: queryKeys.seasons(teamId ?? 0),
		queryFn: async ({ signal }) => (await api.get<{ seasons: Season[] }>(`/teams/${teamId}/seasons`, signal)).seasons,
		enabled: teamId !== null,
		staleTime: 5 * 60_000,
	})
}

export function useBalances(seasonId: number | null) {
	return useQuery({
		queryKey: queryKeys.balances(seasonId ?? 0),
		queryFn: ({ signal }) => api.get<BalanceList>(`/seasons/${seasonId}/balances`, signal),
		enabled: seasonId !== null,
	})
}

export function useRoster(seasonId: number | null) {
	return useQuery({
		queryKey: [...queryKeys.season(seasonId ?? 0), 'roster'] as const,
		queryFn: async ({ signal }) =>
			(await api.get<{ roster: RosterEntry[] }>(`/seasons/${seasonId}/roster`, signal)).roster,
		enabled: seasonId !== null,
	})
}

export function useTeamMembers(teamId: number | null) {
	return useQuery({
		queryKey: queryKeys.members(teamId ?? 0),
		queryFn: async ({ signal }) =>
			(await api.get<{ members: TeamMember[] }>(`/teams/${teamId}/members`, signal)).members,
		enabled: teamId !== null,
		staleTime: 60_000,
	})
}

export interface NewSeasonInput {
	name: string
	startsOn: string
	endsOn: string
}

/** Server sám zruší příznak aktuální sezóny u ostatních — v družstvu smí být jen jedna. */
export function useCreateSeason(teamId: number) {
	const queryClient = useQueryClient()

	return useMutation({
		mutationFn: (input: NewSeasonInput) => api.post<Season>(`/teams/${teamId}/seasons`, input),
		onSuccess: () => {
			void queryClient.invalidateQueries({ queryKey: queryKeys.seasons(teamId) })
			void queryClient.invalidateQueries({ queryKey: queryKeys.teams })
		},
	})
}

export function useCloseSeason(teamId: number) {
	const queryClient = useQueryClient()

	return useMutation({
		mutationFn: (seasonId: number) => api.post<Season>(`/seasons/${seasonId}/close`),
		onSuccess: () => {
			void queryClient.invalidateQueries({ queryKey: queryKeys.seasons(teamId) })
		},
	})
}

export function useSaveRoster(teamId: number) {
	const queryClient = useQueryClient()

	return useMutation({
		mutationFn: ({ seasonId, membershipIds }: { seasonId: number; membershipIds: number[] }) =>
			api.put<{ roster: RosterEntry[] }>(`/seasons/${seasonId}/roster`, { membershipIds }),
		onSuccess: (_data, variables) => {
			void queryClient.invalidateQueries({ queryKey: queryKeys.season(variables.seasonId) })
			void queryClient.invalidateQueries({ queryKey: queryKeys.seasons(teamId) })
		},
	})
}

/**
 * Převzetí sazebníku z jiné sezóny. Bez `items` se kopíruje celý, s nimi jen
 * vybrané položky a volitelně za jinou cenu — ceny se mezi sezónami mění častěji
 * než samotný seznam prohřešků.
 */
export interface CopyOffenceTypesInput {
	targetSeasonId: number
	sourceSeasonId: number
	items?: Array<{ offenceTypeId: number; amountCzk?: number }>
}

export function useCopyOffenceTypes() {
	const queryClient = useQueryClient()

	return useMutation({
		mutationFn: ({ targetSeasonId, sourceSeasonId, items }: CopyOffenceTypesInput) =>
			api.post<{ createdCount: number; skipped: unknown[] }>(
				`/seasons/${targetSeasonId}/offence-types/copy-from/${sourceSeasonId}`,
				items === undefined ? undefined : { items },
			),
		onSuccess: (_data, variables) => {
			void queryClient.invalidateQueries({ queryKey: queryKeys.season(variables.targetSeasonId) })
		},
	})
}

export interface TeamDebt {
	teamId: number
	seasonName: string | null
	/** `null` znamená, že tým nemá rozjetou sezónu — pak není z čeho dluh počítat. */
	balanceCzk: number | null
}

/**
 * Můj dluh v každém družstvu zvlášť. Kdo hraje za muže i za juniory, potřebuje
 * vidět obojí naráz — jinak by musel přepínat tým jen kvůli jednomu číslu.
 *
 * Jde o tolik dotazů, kolik má člověk týmů, ale odpovědi sdílí klíč s přehledem
 * dluhů, takže se z cache většinou vezmou hotové.
 */
export function useMyDebts(teams: TeamSummary[]): { debts: TeamDebt[]; isPending: boolean } {
	return useQueries({
		queries: teams.map((team) => ({
			queryKey: queryKeys.balances(team.currentSeason?.id ?? 0),
			queryFn: ({ signal }: { signal: AbortSignal }) =>
				api.get<BalanceList>(`/seasons/${team.currentSeason?.id}/balances`, signal),
			enabled: team.currentSeason !== null,
		})),
		combine: (results) => ({
			// Vypnuté dotazy zůstávají navždy „pending", takže se počítají jen ty,
			// které se opravdu ptají.
			isPending: results.some((result, index) => teams[index]?.currentSeason != null && result.isPending),
			debts: teams.map((team, index) => {
				const mine = results[index]?.data?.members.find((member) => member.membershipId === team.membershipId)

				return {
					teamId: team.id,
					seasonName: team.currentSeason?.name ?? null,
					balanceCzk: mine?.balanceCzk ?? null,
				}
			}),
		}),
	})
}

export function useOffenceTypes(seasonId: number | null) {
	return useQuery({
		queryKey: queryKeys.offenceTypes(seasonId ?? 0),
		// Controller balí seznam do `{ items: [...] }` (viz OffenceTypeController::index),
		// proto se tu rozbaluje — jinak by `data` bylo za běhu objekt, ne pole.
		queryFn: async ({ signal }) => {
			const response = await api.get<{ items: OffenceType[] }>(`/seasons/${seasonId}/offence-types`, signal)

			return response.items
		},
		enabled: seasonId !== null,
		staleTime: 60_000,
	})
}

/**
 * Sazebník včetně archivovaných položek — pro sekci „Archivované" v sazebníku.
 * Běžný přehled dál používá `useOffenceTypes`, tenhle hook slouží jen té
 * jedné sbalené sekci s historií.
 */
export function useArchivedOffenceTypes(seasonId: number | null) {
	return useQuery({
		queryKey: [...queryKeys.offenceTypes(seasonId ?? 0), 'archived'] as const,
		queryFn: async ({ signal }) => {
			const response = await api.get<{ items: OffenceType[] }>(
				`/seasons/${seasonId}/offence-types?includeArchived=1`,
				signal,
			)

			return response.items.filter((item) => item.archivedAt !== null)
		},
		enabled: seasonId !== null,
		staleTime: 60_000,
	})
}

/** Tělo požadavku na novou položku sazebníku. */
export interface OffenceTypeInput {
	name: string
	amountCzk: number
	category: OffenceCategory | null
}

export function useCreateOffenceType(seasonId: number) {
	const queryClient = useQueryClient()

	return useMutation({
		mutationFn: (input: OffenceTypeInput) => api.post<OffenceType>(`/seasons/${seasonId}/offence-types`, input),
		onSuccess: () => {
			void queryClient.invalidateQueries({ queryKey: queryKeys.offenceTypes(seasonId) })
		},
	})
}

/** Tělo požadavku na úpravu položky — posílají se jen pole, která se mění. */
export interface OffenceTypeChanges {
	name?: string
	amountCzk?: number
	category?: OffenceCategory | null
}

export function useUpdateOffenceType(seasonId: number) {
	const queryClient = useQueryClient()

	return useMutation({
		mutationFn: ({ id, changes }: { id: number; changes: OffenceTypeChanges }) =>
			api.patch<OffenceType>(`/offence-types/${id}`, changes),
		onSuccess: () => {
			void queryClient.invalidateQueries({ queryKey: queryKeys.offenceTypes(seasonId) })
		},
	})
}

/**
 * Nové pořadí sazebníku. V tomhle pořadí se položky nabízejí při zápisu, takže
 * si pínař srovná nahoru to, co zapisuje po každém tréninku.
 *
 * Posílá se celý seznam ID, ne jednotlivé posuny — server je pak uloží v jedné
 * transakci a přerušené přetahování nenechá sazebník v půlce.
 */
export function useReorderOffenceTypes(seasonId: number) {
	const queryClient = useQueryClient()

	return useMutation({
		mutationFn: (offenceTypeIds: number[]) =>
			api.put<{ items: OffenceType[] }>(`/seasons/${seasonId}/offence-types/order`, { offenceTypeIds }),
		onSuccess: () => {
			void queryClient.invalidateQueries({ queryKey: queryKeys.offenceTypes(seasonId) })
		},
	})
}

/** DELETE znamená archivaci, ne smazání — položka nese zapsanou historii. */
export function useArchiveOffenceType(seasonId: number) {
	const queryClient = useQueryClient()

	return useMutation({
		mutationFn: (id: number) => api.delete<OffenceType>(`/offence-types/${id}`),
		onSuccess: () => {
			void queryClient.invalidateQueries({ queryKey: queryKeys.offenceTypes(seasonId) })
		},
	})
}

export function useRecords(seasonId: number | null, membershipId?: number) {
	return useQuery({
		queryKey: queryKeys.records(seasonId ?? 0, membershipId),
		queryFn: ({ signal }) => {
			const query = membershipId === undefined ? '' : `?member=${membershipId}`

			return api.get<RecordList>(`/seasons/${seasonId}/offences${query}`, signal)
		},
		enabled: seasonId !== null,
	})
}

/**
 * Dávkový zápis. Server je idempotentní přes `clientUuid`, takže opakované
 * odeslání téhož těla (dvojklik, výpadek sítě) nic nezdvojí — proto se smí
 * bez obav zkoušet znovu.
 */
export function useCreateBatch(seasonId: number) {
	const queryClient = useQueryClient()

	return useMutation({
		mutationFn: (input: BatchInput) => api.post<BatchSummary>(`/seasons/${seasonId}/offence-batches`, input),
		onSuccess: () => {
			void queryClient.invalidateQueries({ queryKey: queryKeys.season(seasonId) })
		},
	})
}

export function useVoidRecord(seasonId: number) {
	const queryClient = useQueryClient()

	return useMutation({
		mutationFn: (recordId: number) => api.post(`/offences/${recordId}/void`),
		onSuccess: () => {
			void queryClient.invalidateQueries({ queryKey: queryKeys.season(seasonId) })
		},
	})
}
