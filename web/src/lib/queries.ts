import { useMutation, useQueries, useQuery, useQueryClient } from '@tanstack/react-query'

import { api } from '@/lib/api'
import type {
	ActivationBatch,
	Attendance,
	AutoEventType,
	AutoRule,
	AttendanceRow,
	BalanceList,
	BatchInput,
	BatchSummary,
	CalendarFeed,
	ClubLocation,
	EventDetail,
	EventSeries,
	EventType,
	IssuedLink,
	IssuedCalendarFeed,
	NotificationPreferences,
	NotificationSettings,
	PushSubscriptionInput,
	MemberStatus,
	Nomination,
	OffenceCategory,
	OffenceType,
	PlatformClub,
	RecordList,
	Role,
	RosterEntry,
	Rsvp,
	Season,
	TeamDetail,
	TeamEvent,
	TeamInvitation,
	TeamMember,
	TeamSettings,
	Payment,
	PaymentMethod,
	PaymentQr,
	TravelClaim,
	TravelSyncResult,
	TeamSummary,
	Transport,
} from '@/lib/types'

// Klíče na jednom místě — struktura kopíruje API cesty pro přesnou invalidaci
export const queryKeys = {
	teams: ['teams'] as const,
	seasons: (teamId: number) => ['teams', teamId, 'seasons'] as const,
	season: (seasonId: number) => ['seasons', seasonId] as const,
	balances: (seasonId: number) => ['seasons', seasonId, 'balances'] as const,
	payments: (seasonId: number, membershipId?: number) =>
		['seasons', seasonId, 'payments', membershipId ?? 'all'] as const,
	travelClaims: (seasonId: number, membershipId?: number) =>
		['seasons', seasonId, 'travel-claims', membershipId ?? 'all'] as const,
	paymentQr: (seasonId: number, membershipId: number) => ['payment-qr', seasonId, membershipId] as const,
	offenceTypes: (seasonId: number) => ['seasons', seasonId, 'offence-types'] as const,
	records: (seasonId: number, membershipId?: number) =>
		['seasons', seasonId, 'records', membershipId ?? 'all'] as const,
	batch: (batchId: number) => ['batches', batchId] as const,
	members: (teamId: number) => ['teams', teamId, 'members'] as const,
	invitations: (teamId: number) => ['teams', teamId, 'invitations'] as const,
	events: (seasonId: number) => ['seasons', seasonId, 'events'] as const,
	event: (eventId: number) => ['events', eventId] as const,
	series: (seasonId: number) => ['seasons', seasonId, 'event-series'] as const,
	attendance: (seasonId: number, type?: EventType) => ['seasons', seasonId, 'attendance', type ?? 'all'] as const,
	locations: (clubId: number) => ['clubs', clubId, 'locations'] as const,
	calendarFeeds: ['me', 'calendar-feeds'] as const,
	notificationSettings: ['me', 'notifications', 'settings'] as const,
}

export function useNotificationSettings() {
	return useQuery({
		queryKey: queryKeys.notificationSettings,
		queryFn: ({ signal }) => api.get<NotificationSettings>('/me/notifications/settings', signal),
	})
}

export function useSubscribePush() {
	const queryClient = useQueryClient()

	return useMutation({
		mutationFn: (subscription: PushSubscriptionInput) =>
			api.post<NotificationSettings>('/push/subscribe', subscription),
		onSuccess: (settings) => queryClient.setQueryData(queryKeys.notificationSettings, settings),
	})
}

export function useUnsubscribePush() {
	const queryClient = useQueryClient()

	return useMutation({
		mutationFn: (endpoint: string) => api.post<void>('/push/unsubscribe', { endpoint }),
		onSuccess: () => queryClient.invalidateQueries({ queryKey: queryKeys.notificationSettings }),
	})
}

export function useSaveNotificationPreferences() {
	const queryClient = useQueryClient()
	const apply = (preferences: NotificationPreferences) =>
		queryClient.setQueryData<NotificationSettings>(queryKeys.notificationSettings, (current) =>
			current === undefined ? current : { ...current, preferences },
		)

	return useMutation({
		mutationFn: (preferences: NotificationPreferences) =>
			api.put<{ preferences: NotificationPreferences }>('/me/notifications/preferences', preferences),
		// Přepínač se překlopí hned. Čekat na odpověď znamenalo, že cvaknutí chvíli
		// nic nedělalo a celý seznam mezitím zešednul.
		onMutate: (preferences) => {
			const previous = queryClient.getQueryData<NotificationSettings>(queryKeys.notificationSettings)
			apply(preferences)

			return { previous }
		},
		onError: (_error, _preferences, context) => {
			if (context?.previous !== undefined) apply(context.previous.preferences)
		},
		onSuccess: ({ preferences }) => apply(preferences),
	})
}

// Seznamy přijdou zabalené pro budoucí stránkování — hooky je rozbalují
export function useTeams() {
	return useQuery({
		queryKey: queryKeys.teams,
		queryFn: async ({ signal }) => (await api.get<{ teams: TeamSummary[] }>('/me/teams', signal)).teams,
		staleTime: 5 * 60_000,
	})
}

export function useCalendarFeeds() {
	return useQuery({
		queryKey: queryKeys.calendarFeeds,
		queryFn: async ({ signal }) => (await api.get<{ feeds: CalendarFeed[] }>('/me/calendar-feeds', signal)).feeds,
	})
}

export function useIssueCalendarFeed() {
	const queryClient = useQueryClient()

	return useMutation({
		mutationFn: (seasonId: number) => api.post<IssuedCalendarFeed>(`/seasons/${seasonId}/calendar-feed`),
		onSuccess: () => queryClient.invalidateQueries({ queryKey: queryKeys.calendarFeeds }),
	})
}

export function useRevokeCalendarFeed() {
	const queryClient = useQueryClient()

	return useMutation({
		mutationFn: (feedId: number) => api.delete<void>(`/calendar-feeds/${feedId}`),
		onSuccess: () => queryClient.invalidateQueries({ queryKey: queryKeys.calendarFeeds }),
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

export function usePayments(seasonId: number | null, membershipId?: number) {
	return useQuery({
		queryKey: queryKeys.payments(seasonId ?? 0, membershipId),
		queryFn: async ({ signal }) => {
			const params = new URLSearchParams({ includeVoided: '1' })
			if (membershipId !== undefined) params.set('membershipId', String(membershipId))

			return (await api.get<{ items: Payment[] }>(`/seasons/${seasonId}/payments?${params}`, signal)).items
		},
		enabled: seasonId !== null,
	})
}

export function useCreatePayment(seasonId: number) {
	const queryClient = useQueryClient()

	return useMutation({
		mutationFn: (input: {
			membershipId: number
			amountCzk: number
			paidOn: string
			method: PaymentMethod
			note?: string | null
		}) => api.post<Payment>(`/seasons/${seasonId}/payments`, input),
		onSuccess: (payment) => {
			void queryClient.invalidateQueries({ queryKey: queryKeys.balances(seasonId) })
			void queryClient.invalidateQueries({ queryKey: queryKeys.payments(seasonId, payment.membershipId) })
			void queryClient.invalidateQueries({ queryKey: queryKeys.paymentQr(seasonId, payment.membershipId) })
		},
	})
}

export function useVoidPayment(seasonId: number) {
	const queryClient = useQueryClient()

	return useMutation({
		mutationFn: (paymentId: number) => api.post<Payment>(`/payments/${paymentId}/void`),
		onSuccess: (payment) => {
			void queryClient.invalidateQueries({ queryKey: queryKeys.balances(seasonId) })
			void queryClient.invalidateQueries({ queryKey: queryKeys.payments(seasonId, payment.membershipId) })
			void queryClient.invalidateQueries({ queryKey: queryKeys.paymentQr(seasonId, payment.membershipId) })
		},
	})
}

export function useTravelClaims(seasonId: number | null, membershipId?: number) {
	return useQuery({
		queryKey: queryKeys.travelClaims(seasonId ?? 0, membershipId),
		queryFn: async ({ signal }) => {
			const params = new URLSearchParams({ includeVoided: '1' })
			if (membershipId !== undefined) params.set('membershipId', String(membershipId))

			return (await api.get<{ items: TravelClaim[] }>(`/seasons/${seasonId}/travel-claims?${params}`, signal)).items
		},
		enabled: seasonId !== null,
	})
}

export function useSyncTravelClaims(seasonId: number) {
	const queryClient = useQueryClient()

	return useMutation({
		mutationFn: () => api.post<TravelSyncResult>(`/seasons/${seasonId}/travel-claims/sync`),
		onSuccess: () => {
			void queryClient.invalidateQueries({ queryKey: queryKeys.balances(seasonId) })
			void queryClient.invalidateQueries({ queryKey: ['seasons', seasonId, 'travel-claims'] })
			void queryClient.invalidateQueries({ queryKey: ['payment-qr', seasonId] })
		},
	})
}

export function useCreateTravelClaim(seasonId: number) {
	const queryClient = useQueryClient()

	return useMutation({
		mutationFn: (input: { membershipId: number; occurredOn: string; distanceKm: number; note?: string | null }) =>
			api.post<TravelClaim>(`/seasons/${seasonId}/travel-claims`, input),
		onSuccess: (claim) => {
			void queryClient.invalidateQueries({ queryKey: queryKeys.balances(seasonId) })
			void queryClient.invalidateQueries({ queryKey: queryKeys.travelClaims(seasonId, claim.membershipId) })
			void queryClient.invalidateQueries({ queryKey: queryKeys.paymentQr(seasonId, claim.membershipId) })
		},
	})
}

export function useVoidTravelClaim(seasonId: number) {
	const queryClient = useQueryClient()

	return useMutation({
		mutationFn: (claimId: number) => api.post<TravelClaim>(`/travel-claims/${claimId}/void`),
		onSuccess: (claim) => {
			void queryClient.invalidateQueries({ queryKey: queryKeys.balances(seasonId) })
			void queryClient.invalidateQueries({ queryKey: queryKeys.travelClaims(seasonId, claim.membershipId) })
			void queryClient.invalidateQueries({ queryKey: queryKeys.paymentQr(seasonId, claim.membershipId) })
		},
	})
}

export function usePaymentQr(seasonId: number | null, membershipId: number | null) {
	return useQuery({
		queryKey: queryKeys.paymentQr(seasonId ?? 0, membershipId ?? 0),
		queryFn: ({ signal }) => api.get<PaymentQr>(`/memberships/${membershipId}/payment-qr?seasonId=${seasonId}`, signal),
		enabled: seasonId !== null && membershipId !== null,
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

// Nastavení chodí i zpátky celé — PUT přepisuje všechno, ne jen změněné pole
export function useSaveTeamSettings(teamId: number) {
	const queryClient = useQueryClient()

	return useMutation({
		mutationFn: (settings: TeamSettings) => api.put<TeamSettings>(`/teams/${teamId}/settings`, settings),
		onSuccess: () => {
			void queryClient.invalidateQueries({ queryKey: ['teams', teamId, 'detail'] })
			// Domácí hala rozhoduje, co je domácí zápas — kalendář to musí přečíst znovu.
			void queryClient.invalidateQueries({ queryKey: ['seasons'] })
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

/**
 * Přelom pololetí. Prázdná hodnota ho vypne; `balances` se musí zneplatnit,
 * protože se podle něj dělí všechna čísla peněz.
 */
export function useSetHalfYear(teamId: number) {
	const queryClient = useQueryClient()

	return useMutation({
		mutationFn: ({ seasonId, halfYearOn }: { seasonId: number; halfYearOn: string | null }) =>
			api.patch<Season>(`/seasons/${seasonId}`, { halfYearOn }),
		onSuccess: (season) => {
			void queryClient.invalidateQueries({ queryKey: queryKeys.seasons(teamId) })
			void queryClient.invalidateQueries({ queryKey: queryKeys.balances(season.id) })
			void queryClient.invalidateQueries({ queryKey: ['payment-qr', season.id] })
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
	/** Který prohřešek aplikace navrhne z docházky. */
	autoRule?: AutoRule
	autoEventType?: AutoEventType
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
	autoRule?: AutoRule
	autoEventType?: AutoEventType
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

export interface BatchListItem {
	id: number
	occurredOn: string
	title: string | null
	note: string | null
	eventId: number | null
	eventTitle: string | null
	createdBy: { id: number; name: string } | null
	createdAt: string
	voidedAt: string | null
	recordCount: number
	memberCount: number
	totalCzk: number
}

// Zápisy od nejnovějšího — pínař hledá poslední trénink, ne ten zářijový
export function useBatches(seasonId: number | null) {
	return useQuery({
		queryKey: [...queryKeys.season(seasonId ?? 0), 'batches'] as const,
		queryFn: async ({ signal }) =>
			(await api.get<{ items: BatchListItem[] }>(`/seasons/${seasonId}/offence-batches`, signal)).items,
		enabled: seasonId !== null,
	})
}

/** Storno celé dávky. Zápisy se nemažou, jen se označí — po penězích musí zůstat stopa. */
export function useVoidBatch(seasonId: number) {
	const queryClient = useQueryClient()

	return useMutation({
		mutationFn: (batchId: number) => api.post(`/offence-batches/${batchId}/void`),
		onSuccess: () => {
			void queryClient.invalidateQueries({ queryKey: queryKeys.season(seasonId) })
		},
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

// --- docházka ------------------------------------------------------------

export function useEvents(seasonId: number | null) {
	return useQuery({
		queryKey: queryKeys.events(seasonId ?? 0),
		queryFn: async ({ signal }) =>
			(await api.get<{ events: TeamEvent[] }>(`/seasons/${seasonId}/events`, signal)).events,
		enabled: seasonId !== null,
	})
}

export function useEvent(eventId: number | null) {
	return useQuery({
		queryKey: queryKeys.event(eventId ?? 0),
		queryFn: ({ signal }) => api.get<EventDetail>(`/events/${eventId}`, signal),
		enabled: eventId !== null,
	})
}

export interface RsvpInput {
	rsvp: Rsvp
	note?: string | null
	transport: Transport
	carSeats?: number | null
}

// Odpověď hráče za sebe. Jde jen do začátku akce — pak už je z ní docházka.
export function useSaveRsvp(eventId: number, seasonId: number | null) {
	const queryClient = useQueryClient()

	return useMutation({
		mutationFn: (input: RsvpInput) => api.put<EventDetail>(`/events/${eventId}/rsvp`, input),
		onSuccess: (detail) => {
			queryClient.setQueryData(queryKeys.event(eventId), detail)
			if (seasonId !== null) void queryClient.invalidateQueries({ queryKey: queryKeys.events(seasonId) })
		},
	})
}

export interface AttendanceChange {
	membershipId: number
	/** `null` opravu zruší a vrátí odvození z odpovědi hráče. */
	attendance: Attendance | null
	/**
	 * Zpětná oprava dopravy u venkovního zápasu — kdo zapomněl říct, že jede
	 * autem. Vynechané pole nechává dopravu být, server ji u tréninku a domácího
	 * zápasu ignoruje.
	 */
	transport?: Transport
}

export function useSaveAttendance(eventId: number, seasonId: number | null) {
	const queryClient = useQueryClient()

	return useMutation({
		mutationFn: (items: AttendanceChange[]) => api.put<EventDetail>(`/events/${eventId}/attendance`, { items }),
		onSuccess: (detail) => {
			queryClient.setQueryData(queryKeys.event(eventId), detail)
			if (seasonId !== null) {
				void queryClient.invalidateQueries({ queryKey: ['seasons', seasonId, 'attendance'] })
				// Řidič navíc znamená nový cesťák, jen se ještě musí načíst.
				void queryClient.invalidateQueries({ queryKey: ['seasons', seasonId, 'travel-claims'] })
			}
		},
	})
}

export function useSaveNominations(eventId: number) {
	const queryClient = useQueryClient()

	return useMutation({
		mutationFn: (items: Array<{ membershipId: number; nomination: Nomination }>) =>
			api.put<EventDetail>(`/events/${eventId}/nominations`, { items }),
		onSuccess: (detail) => {
			queryClient.setQueryData(queryKeys.event(eventId), detail)
		},
	})
}

export interface EventInput {
	type: EventType
	title: string
	startsAt: string
	endsAt?: string | null
	meetAt?: string | null
	locationId?: number | null
	opponent?: string | null
	note?: string | null
	distanceKm?: number | null
}

export function useCreateEvent(seasonId: number) {
	const queryClient = useQueryClient()

	return useMutation({
		mutationFn: (input: EventInput) => api.post<TeamEvent>(`/seasons/${seasonId}/events`, input),
		onSuccess: () => {
			void queryClient.invalidateQueries({ queryKey: queryKeys.events(seasonId) })
		},
	})
}

export function useUpdateEvent(eventId: number, seasonId: number | null) {
	const queryClient = useQueryClient()

	return useMutation({
		mutationFn: (changes: Partial<EventInput>) => api.patch<TeamEvent>(`/events/${eventId}`, changes),
		onSuccess: () => {
			void queryClient.invalidateQueries({ queryKey: queryKeys.event(eventId) })
			if (seasonId !== null) void queryClient.invalidateQueries({ queryKey: queryKeys.events(seasonId) })
		},
	})
}

// Zrušená akce se nemaže — nese odpovědi hráčů i případné prohřešky
export function useCancelEvent(eventId: number, seasonId: number | null) {
	const queryClient = useQueryClient()

	return useMutation({
		mutationFn: (cancelled: boolean) => api.post<TeamEvent>(`/events/${eventId}/${cancelled ? 'cancel' : 'restore'}`),
		onSuccess: () => {
			void queryClient.invalidateQueries({ queryKey: queryKeys.event(eventId) })
			if (seasonId !== null) void queryClient.invalidateQueries({ queryKey: queryKeys.events(seasonId) })
		},
	})
}

/** Smazání je pro překlepy; zrušení pro akci, o které má tým vědět, že se nekoná. */
export function useDeleteEvent(seasonId: number | null) {
	const queryClient = useQueryClient()

	return useMutation({
		mutationFn: (eventId: number) => api.delete(`/events/${eventId}`),
		onSuccess: () => {
			if (seasonId !== null) void queryClient.invalidateQueries({ queryKey: queryKeys.events(seasonId) })
		},
	})
}

export function useEventSeries(seasonId: number | null) {
	return useQuery({
		queryKey: queryKeys.series(seasonId ?? 0),
		queryFn: async ({ signal }) =>
			(await api.get<{ series: EventSeries[] }>(`/seasons/${seasonId}/event-series`, signal)).series,
		enabled: seasonId !== null,
		staleTime: 60_000,
	})
}

export interface SeriesInput {
	title: string
	type: EventType
	rrule: string
	startTime: string
	durationMin: number
	locationId?: number | null
	meetBeforeMin?: number | null
	defaultNote?: string | null
	activeFrom: string
	activeTo: string
}

/** Série vyrobí všechny termíny naráz — odpověď říká kolik a kolik se přeskočilo. */
export function useCreateSeries(seasonId: number) {
	const queryClient = useQueryClient()

	return useMutation({
		mutationFn: (input: SeriesInput) =>
			api.post<{ series: EventSeries; created: number; skipped: number }>(`/seasons/${seasonId}/event-series`, input),
		onSuccess: () => {
			void queryClient.invalidateQueries({ queryKey: queryKeys.events(seasonId) })
			void queryClient.invalidateQueries({ queryKey: queryKeys.series(seasonId) })
		},
	})
}

/** Rozsah hromadné změny série. Jeden termín se upravuje přes `useUpdateEvent`. */
export type SeriesScope = 'following' | 'all'

export interface SeriesUpdate extends SeriesInput {
	scope: SeriesScope
	/** Termín, od kterého se změna projeví. U rozsahu `all` se neposílá. */
	fromEventId?: number | null
}

export interface SeriesChangeResult {
	series: EventSeries
	updated: number
	created: number
	deleted: number
	/** Ručně upravené termíny, kterých se hromadná změna nedotkla. */
	skipped: number
}

export function useUpdateSeries(seasonId: number) {
	const queryClient = useQueryClient()

	return useMutation({
		mutationFn: ({ seriesId, ...body }: SeriesUpdate & { seriesId: number }) =>
			api.patch<SeriesChangeResult>(`/event-series/${seriesId}`, body),
		onSuccess: () => {
			void queryClient.invalidateQueries({ queryKey: queryKeys.events(seasonId) })
			void queryClient.invalidateQueries({ queryKey: queryKeys.series(seasonId) })
		},
	})
}

// Smazat znamená smazat: jdou i termíny s odpověďmi, u rozsahu `all` i minulé
export function useDeleteSeries(seasonId: number) {
	const queryClient = useQueryClient()

	return useMutation({
		mutationFn: ({ seriesId, scope, fromEventId }: { seriesId: number; scope: SeriesScope; fromEventId?: number }) => {
			const from = scope === 'following' && fromEventId !== undefined ? `&from=${fromEventId}` : ''

			return api.delete<{ deleted: number; kept: number }>(`/event-series/${seriesId}?scope=${scope}${from}`)
		},
		onSuccess: () => {
			void queryClient.invalidateQueries({ queryKey: queryKeys.events(seasonId) })
			void queryClient.invalidateQueries({ queryKey: queryKeys.series(seasonId) })
		},
	})
}

// Hráči se vrátí jen jejich řádek, adminovi celá tabulka — hlídá to server
export function useAttendanceSummary(seasonId: number | null, type?: EventType) {
	return useQuery({
		queryKey: queryKeys.attendance(seasonId ?? 0, type),
		queryFn: async ({ signal }) => {
			const query = type === undefined ? '' : `?type=${type}`

			return (await api.get<{ members: AttendanceRow[] }>(`/seasons/${seasonId}/attendance${query}`, signal)).members
		},
		enabled: seasonId !== null,
	})
}

export function useLocations(clubId: number | null) {
	return useQuery({
		queryKey: queryKeys.locations(clubId ?? 0),
		queryFn: async ({ signal }) =>
			(await api.get<{ locations: ClubLocation[] }>(`/clubs/${clubId}/locations`, signal)).locations,
		enabled: clubId !== null,
		staleTime: 5 * 60_000,
	})
}

export interface LocationInput {
	name: string
	address?: string | null
	lat?: number | null
	lng?: number | null
	note?: string | null
}

export function useCreateLocation(clubId: number) {
	const queryClient = useQueryClient()

	return useMutation({
		mutationFn: (input: LocationInput) => api.post<ClubLocation>(`/clubs/${clubId}/locations`, input),
		onSuccess: () => {
			void queryClient.invalidateQueries({ queryKey: queryKeys.locations(clubId) })
		},
	})
}

export function useUpdateLocation(clubId: number) {
	const queryClient = useQueryClient()

	return useMutation({
		mutationFn: ({ id, changes }: { id: number; changes: LocationInput }) =>
			api.patch<ClubLocation>(`/locations/${id}`, changes),
		onSuccess: () => {
			void queryClient.invalidateQueries({ queryKey: queryKeys.locations(clubId) })
			// Místo se ukazuje i u akcí, takže kalendář i detaily musí přečíst nový název.
			void queryClient.invalidateQueries({ queryKey: ['seasons'] })
			void queryClient.invalidateQueries({ queryKey: ['events'] })
		},
	})
}

// Použité místo server smazat nedá (409) — halu u loňských zápasů nikdo mazat nebude
export function useDeleteLocation(clubId: number) {
	const queryClient = useQueryClient()

	return useMutation({
		mutationFn: (id: number) => api.delete(`/locations/${id}`),
		onSuccess: () => {
			void queryClient.invalidateQueries({ queryKey: queryKeys.locations(clubId) })
		},
	})
}
