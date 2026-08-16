import { useState } from 'react'

import { useCurrentUser } from '@/app/session'
import { Button } from '@/components/ui/Button'
import { ErrorState, LoadingState } from '@/components/ui/States'
import { needsActivation, sortMembers } from '@/features/team/members'
import { OneTimeLinkDialog } from '@/features/team/OneTimeLinkDialog'
import { ApiError } from '@/lib/api'
import { useActivationLink, useTeamMembers, useUpdateMembership } from '@/lib/queries'
import type { IssuedLink, TeamMember } from '@/lib/types'
import { roleLabels } from '@/lib/types'

/**
 * Jmenování admina a vydávání odkázů pro familia bez přístupu.
 * Ostatní agendu spravuje admin klubu.
 */
export function TeamRescue({ teamId, teamName }: { teamId: number; teamName: string }) {
	const me = useCurrentUser()
	const members = useTeamMembers(teamId)
	const updateMembership = useUpdateMembership(teamId)
	const activation = useActivationLink(teamId)

	const [issued, setIssued] = useState<IssuedLink | null>(null)
	const [error, setError] = useState<string | null>(null)

	if (members.isPending) return <LoadingState />
	if (members.error !== null) return <ErrorState error={members.error} onRetry={() => void members.refetch()} />

	const all = sortMembers(members.data ?? [])
	// Admini nahoru — je pro ně primární.
	const ordered = all.toSorted((a, b) => Number(b.role === 'admin') - Number(a.role === 'admin'))

	return (
		<div className="bg-surface-2/50 border-line/60 border-t px-4 py-3">
			{error === null ? null : (
				<p role="alert" className="bg-debt-500/15 text-debt mb-3 rounded-xl px-3 py-2 text-sm">
					{error}
				</p>
			)}

			<div className="divide-line/50 divide-y">
				{ordered.map((member) => (
					<RescueRow
						key={member.id}
						member={member}
						busy={
							(updateMembership.isPending && updateMembership.variables?.membershipId === member.id) ||
							(activation.isPending && activation.variables === member.id)
						}
						onPromote={() => {
							setError(null)
							updateMembership.mutate(
								{ membershipId: member.id, changes: { role: 'admin' } },
								{
									onError: (cause) => {
										setError(cause instanceof ApiError ? cause.message : 'Roli se nepodařilo změnit.')
									},
								},
							)
						}}
						onActivate={() => {
							setError(null)
							activation.mutate(member.id, {
								onSuccess: (result) => setIssued(result.activation),
								onError: (cause) => {
									setError(cause instanceof ApiError ? cause.message : 'Odkaz se nepodařilo vytvořit.')
								},
							})
						}}
					/>
				))}
			</div>

			{all.length === 0 ? (
				<p className="text-ink-muted text-sm">
					Družstvo nemá jediného člena. Prvního přidáte tak, že se do něj přepnete a pozvete ho.
				</p>
			) : null}

			<OneTimeLinkDialog
				link={issued}
				title={`Aktivační odkaz — ${teamName}`}
				description={
					me.mailEnabled
						? 'Odkaz odešel e-mailem. Když zpráva nedojde, pošlete ho ručně — tady je naposledy vidět.'
						: 'Odesílání e-mailů je vypnuté, odkaz předejte sami.'
				}
				onClose={() => setIssued(null)}
			/>
		</div>
	)
}

function RescueRow({
	member,
	busy,
	onPromote,
	onActivate,
}: {
	member: TeamMember
	busy: boolean
	onPromote: () => void
	onActivate: () => void
}) {
	const isAdmin = member.role === 'admin'

	return (
		<div className="flex flex-wrap items-center gap-x-3 gap-y-2 py-2">
			<span className="min-w-0 flex-1">
				<span className="block truncate text-sm font-medium">{member.name}</span>
				<span className="text-ink-faint block truncate text-xs">
					{member.email} · {roleLabels[member.role]}
					{member.hasPassword ? '' : ' · bez hesla'}
				</span>
			</span>

			<span className="flex shrink-0 gap-2">
				{isAdmin ? null : (
					<Button size="sm" variant="ghost" disabled={busy} onClick={onPromote}>
						Jmenovat adminem
					</Button>
				)}
				{needsActivation(member) ? (
					<Button size="sm" variant={isAdmin ? 'accent' : 'ghost'} loading={busy} onClick={onActivate}>
						Odkaz
					</Button>
				) : null}
			</span>

			{isAdmin ? <span className="bg-brand-600/15 rounded-full px-2 py-0.5 text-xs">admin</span> : null}
		</div>
	)
}
