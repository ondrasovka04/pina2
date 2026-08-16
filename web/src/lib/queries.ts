import { useMutation, useQueries, useQuery, useQueryClient } from '@tanstack/react-query'

import { api } from '@/lib/api'
import type {
	ActivationBatch,
	BalanceList,
	BatchInput,
	BatchSummary,
	IssuedLink,
	MemberStatus,
	OffenceCategory,
	OffenceType,
	PlatformClub,
	RecordList,
	Role,
	RosterEntry,
	Season,
	TeamDetail,
	TeamInvitation,
	TeamMember,
	TeamSummary,
} from '@/lib/types'

// Klíče na jednom místě — struktura kopíruje API cesty pro přesnou invalidaci
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
	invitations: (teamId: number) => ['teams', teamId, 'invitations'] as const,
}

// Seznamy přijdou zabalené pro budoucí stránkování — hooky je rozbalují
export function useTeams() {
	return useQuery({
		queryKey: queryKeys.teams,
		queryFn: async ({ signal }) => (await api.get<{ teams: TeamSummary[] }>('/me/teams', signal)).teams,
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

export function usePlatformClubs(enabled: boolean) {
	return useQuery({
		queryKey: ['admin', 'clubs'] as const,
		queryFn: async ({ signal }) => (await api.get<{ clubs: PlatformClub[] }>('/admin/clubs', signal)).clubs,
		enabled,
	})
}

export function useCreateClub() {
	const queryClient = useQueryClient()

	return useMutation({
		mutationFn: (name: string) => api.post<{ club: { id: number; name: string; slug: string } }>('/clubs', { name }),
		onSuccess: () => {
			void queryClient.invalidateQueries({ queryKey: ['admin', 'clubs'] })
		},
	})
}

export function useTeamDetail(teamId: number | null) {
	return useQuery({
		queryKey: ['teams', teamId ?? 0, 'detail'] as const,
		queryFn: ({ signal }) => api.get<TeamDetail>(`/teams/${teamId}`, signal),
		enabled: teamId !== null,
		staleTime: 60_000,
	})
}

export function useRenameTeam(teamId: number) {
	const queryClient = useQueryClient()

	return useMutation({
		mutationFn: (name: string) => api.patch<TeamDetail>(`/teams/${teamId}`, { name }),
		onSuccess: () => {
			void queryClient.invalidateQueries({ queryKey: ['teams', teamId, 'detail'] })
			void queryClient.invalidateQueries({ queryKey: queryKeys.teams })
		},
	})
}

export function useCreateTeam(clubId: number) {
	const queryClient = useQueryClient()

	return useMutation({
		mutationFn: ({ name, color }: { name: string; color?: string }) =>
			api.post<TeamDetail>(`/clubs/${clubId}/teams`, color === undefined ? { name } : { name, color }),
		onSuccess: () => {
			void queryClient.invalidateQueries({ queryKey: queryKeys.teams })
			void queryClient.invalidateQueries({ queryKey: ['admin', 'clubs'] })
		},
	})
}

export interface MembershipChanges {
	name?: string
	role?: Role
	status?: MemberStatus
	jerseyNumber?: number | null
}

export function useUpdateMembership(teamId: number) {
	const queryClient = useQueryClient()

	return useMutation({
		mutationFn: ({ membershipId, changes }: { membershipId: number; changes: MembershipChanges }) =>
			api.patch<TeamMember>(`/memberships/${membershipId}`, changes),
		onSuccess: () => {
			void queryClient.invalidateQueries({ queryKey: queryKeys.members(teamId) })
			void queryClient.invalidateQueries({ queryKey: queryKeys.teams })
			void queryClient.invalidateQueries({ queryKey: ['admin', 'clubs'] })
		},
	})
}

export function useInvitations(teamId: number | null, enabled: boolean) {
	return useQuery({
		queryKey: queryKeys.invitations(teamId ?? 0),
		queryFn: async ({ signal }) =>
			(await api.get<{ invitations: TeamInvitation[] }>(`/teams/${teamId}/invitations`, signal)).invitations,
		enabled: teamId !== null && enabled,
	})
}

// Token jen v odpovědi — v DB je jen otisk, ztracený odkaz = nová pozvánka
export function useInviteMember(teamId: number) {
	const queryClient = useQueryClient()

	return useMutation({
		mutationFn: ({ email, role, sendEmail }: { email: string; role: Role; sendEmail: boolean }) =>
			api.post<{ invitation: IssuedLink & { id: number } }>(`/teams/${teamId}/members`, { email, role, sendEmail }),
		onSuccess: () => {
			void queryClient.invalidateQueries({ queryKey: queryKeys.invitations(teamId) })
		},
	})
}

// Nový token — stará pozvánka přestává platit
export function useResendInvitation(teamId: number) {
	const queryClient = useQueryClient()

	return useMutation({
		mutationFn: (invitationId: number) =>
			api.post<{ invitation: IssuedLink & { id: number } }>(`/invitations/${invitationId}/resend`),
		onSuccess: () => {
			void queryClient.invalidateQueries({ queryKey: queryKeys.invitations(teamId) })
		},
	})
}

// Hromadné rozeslání — server posílá dávkami
export function useSendActivationEmails(teamId: number) {
	const queryClient = useQueryClient()

	return useMutation({
		mutationFn: () => api.post<ActivationBatch>(`/teams/${teamId}/activation-emails`),
		onSuccess: () => {
			void queryClient.invalidateQueries({ queryKey: queryKeys.invitations(teamId) })
		},
	})
}

export function useRevokeInvitation(teamId: number) {
	const queryClient = useQueryClient()

	return useMutation({
		mutationFn: (invitationId: number) => api.delete(`/invitations/${invitationId}`),
		onSuccess: () => {
			void queryClient.invalidateQueries({ queryKey: queryKeys.invitations(teamId) })
		},
	})
}

// Stávající členy bez hesla se přihlásí přes aktivační odkaz
export function useActivationLink(teamId: number) {
	const queryClient = useQueryClient()

	return useMutation({
		mutationFn: (membershipId: number) =>
			api.post<{ activation: IssuedLink }>(`/memberships/${membershipId}/activation`),
		onSuccess: () => {
			void queryClient.invalidateQueries({ queryKey: queryKeys.invitations(teamId) })
		},
	})
}

export interface NewSeasonInput {
	name: string
	startsOn: string
	endsOn: string
}

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
	balanceCzk: number | null
}

// Má dluh v každém družstvu — různé sezóny se vidí bez přepínání týmu
export function useMyDebts(teams: TeamSummary[]): { debts: TeamDebt[]; isPending: boolean } {
	return useQueries({
		queries: teams.map((team) => ({
			queryKey: queryKeys.balances(team.currentSeason?.id ?? 0),
			queryFn: ({ signal }: { signal: AbortSignal }) =>
				api.get<BalanceList>(`/seasons/${team.currentSeason?.id}/balances`, signal),
			enabled: team.currentSeason !== null,
		})),
		combine: (results) => ({
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
		queryFn: async ({ signal }) => {
			const response = await api.get<{ items: OffenceType[] }>(`/seasons/${seasonId}/offence-types`, signal)

			return response.items
		},
		enabled: seasonId !== null,
		staleTime: 60_000,
	})
}

// Sazebník včetně archivů — jen pro jednu sbalovanou sekci
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

// Nové pořadí sazebníku — celý seznam ID v jedné transakci
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

// Dávkový zápis — idempotentní přes clientUuid
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
