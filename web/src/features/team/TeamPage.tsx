import type { SubmitEvent } from 'react'
import { useState } from 'react'

import { useCurrentUser } from '@/app/session'
import { useTeam } from '@/app/team'
import { Button } from '@/components/ui/Button'
import { Card } from '@/components/ui/Card'
import { Field } from '@/components/ui/Field'
import { ImageUpload } from '@/components/ui/ImageUpload'
import { EmptyState, ErrorState, LoadingState } from '@/components/ui/States'
import { AuditLogSection } from '@/features/team/AuditLogSection'
import { InvitationsSection } from '@/features/team/InvitationsSection'
import { MemberRow } from '@/features/team/MemberRow'
import { describeBatch, needsActivation, sortMembers } from '@/features/team/members'
import { NewTeamSection } from '@/features/team/NewTeamSection'
import { OneTimeLinkDialog } from '@/features/team/OneTimeLinkDialog'
import { TeamSettingsSection } from '@/features/team/TeamSettingsSection'
import { ApiError } from '@/lib/api'
import { plural } from '@/lib/plural'
import {
	useActivationLink,
	useRenameTeam,
	useSaveTeamImage,
	useSendActivationEmails,
	useTeamDetail,
	useTeamMembers,
	useUpdateMembership,
} from '@/lib/queries'
import type { ActivationBatch, IssuedLink, TeamDetail } from '@/lib/types'

type IssuedKind = 'invitation' | 'activation'

/**
 * Správa členství. Členství se nemaže, jen mění stav — odešlí padají dolů.
 */
export function TeamPage() {
	const { team, can } = useTeam()
	const me = useCurrentUser()
	const isAdmin = can('admin')

	const teamId = team?.id ?? null
	const members = useTeamMembers(teamId)
	const detail = useTeamDetail(teamId)
	const updateMembership = useUpdateMembership(teamId ?? 0)
	const activation = useActivationLink(teamId ?? 0)

	const [issued, setIssued] = useState<{ kind: IssuedKind; link: IssuedLink } | null>(null)
	const [failure, setFailure] = useState<string | null>(null)

	if (!isAdmin || team === null) {
		return (
			<EmptyState
				title="Družstvo spravuje admin"
				description="Přidávání lidí a přidělování rolí má na starosti admin družstva. Pro přístup k téhle stránce ho poproste."
			/>
		)
	}

	if (members.isPending) return <LoadingState />
	if (members.error !== null) return <ErrorState error={members.error} onRetry={() => void members.refetch()} />

	const all = sortMembers(members.data ?? [])
	const activeCount = all.filter((member) => member.status !== 'left').length
	const withoutPassword = all.filter(needsActivation).length

	async function issueActivation(membershipId: number) {
		setFailure(null)

		try {
			const result = await activation.mutateAsync(membershipId)
			setIssued({ kind: 'activation', link: result.activation })
		} catch (cause) {
			setFailure(cause instanceof ApiError ? cause.message : 'Odkaz se nepodařilo vytvořit.')
		}
	}

	return (
		<div className="flex flex-col gap-4">
			<h1 className="text-lg font-semibold">Družstvo</h1>

			<TeamNameCard teamId={team.id} name={team.name} clubName={team.clubName} />

			{detail.data === undefined ? null : <TeamImageCard team={detail.data} />}

			{failure === null ? null : (
				<p role="alert" className="bg-debt-500/15 text-debt rounded-xl px-3 py-2 text-sm">
					{failure}
				</p>
			)}

			<Card className="px-4 py-3">
				<div className="flex flex-wrap items-baseline justify-between gap-2">
					<h2 className="font-semibold">Členové</h2>
					<p className="text-ink-faint text-sm">
						{plural(activeCount, 'člen', 'členové', 'členů')}
						{all.length === activeCount ? null : ` · ${all.length - activeCount} odešlo`}
					</p>
				</div>

				{withoutPassword === 0 ? null : (
					<ActivationBanner teamId={team.id} count={withoutPassword} mailEnabled={me.mailEnabled} />
				)}

				<div className="mt-2">
					{all.map((member) => (
						<MemberRow
							key={member.id}
							member={member}
							members={all}
							isMe={member.userId === me.id}
							busy={
								(updateMembership.isPending && updateMembership.variables?.membershipId === member.id) ||
								(activation.isPending && activation.variables === member.id)
							}
							onChange={(changes) => {
								setFailure(null)
								updateMembership.mutate(
									{ membershipId: member.id, changes },
									{
										onError: (cause) => {
											setFailure(cause instanceof ApiError ? cause.message : 'Změnu se nepodařilo uložit.')
										},
									},
								)
							}}
							onActivate={() => void issueActivation(member.id)}
						/>
					))}
				</div>
			</Card>

			<InvitationsSection teamId={team.id} onIssued={(link) => setIssued({ kind: 'invitation', link })} />

			{detail.data === undefined ? null : <TeamSettingsSection team={detail.data} />}

			<AuditLogSection teamId={team.id} />

			<NewTeamSection clubId={team.clubId} clubName={team.clubName} />

			<OneTimeLinkDialog
				link={issued?.link ?? null}
				title={issued?.kind === 'activation' ? 'Aktivační odkaz' : 'Pozvánka je připravená'}
				description={
					issued?.kind === 'activation'
						? 'Pošlete odkaz členovi do chatu. Nastaví si přes něj heslo a dostane se do aplikace se svou stávající rolí.'
						: 'Pošlete odkaz pozvanému do chatu. Vyplní si jméno a heslo a tím se do družstva přidá.'
				}
				onClose={() => setIssued(null)}
			/>
		</div>
	)
}

function TeamImageCard({ team }: { team: TeamDetail }) {
	const save = useSaveTeamImage(team.id)

	return (
		<Card className="p-4">
			<div className="mb-3">
				<h2 className="font-semibold">Znak družstva</h2>
				<p className="text-ink-faint text-sm">Bez něj se všude kreslí znak klubu.</p>
			</div>
			<ImageUpload
				name={team.name}
				imageUrl={team.logoUrl}
				shape="rounded"
				onSave={(image) => save.mutateAsync(image).then(() => undefined)}
			/>
		</Card>
	)
}

/**
 * Hromadné rozeslání aktivačních odkázů. Server posílá po dávkách a říká,
 * kolik lidí ještě zbývá.
 */
function ActivationBanner({ teamId, count, mailEnabled }: { teamId: number; count: number; mailEnabled: boolean }) {
	const send = useSendActivationEmails(teamId)
	const [result, setResult] = useState<ActivationBatch | null>(null)
	const [error, setError] = useState<string | null>(null)

	const lidi = plural(count, 'člen', 'členové', 'členů')
	const jeste = count === 1 ? 'se ještě nikdy nepřihlásil' : 'se ještě nikdy nepřihlásili'

	return (
		<div className="bg-surface-2 mt-3 flex flex-col gap-2 rounded-xl px-3 py-3">
			<p className="text-sm">
				{lidi} {jeste}.{' '}
				{mailEnabled
					? 'Pošlete jim odkaz, kterým si nastaví heslo.'
					: 'Odesílání e-mailů je vypnuté — rozklikněte je a vytvořte jim odkaz jednotlivě.'}
			</p>

			{mailEnabled ? (
				<div className="flex flex-wrap items-center gap-3">
					<Button
						size="sm"
						loading={send.isPending}
						onClick={() => {
							setError(null)
							send.mutate(undefined, {
								onSuccess: setResult,
								onError: (cause) => {
									setError(cause instanceof ApiError ? cause.message : 'Rozeslání selhalo.')
								},
							})
						}}
					>
						Rozeslat aktivační e-maily
					</Button>

					{result === null ? null : <p className="text-ink-muted text-sm">{describeBatch(result)}</p>}
				</div>
			) : null}

			{error === null ? null : (
				<p role="alert" className="text-debt text-sm">
					{error}
				</p>
			)}
		</div>
	)
}

function TeamNameCard({ teamId, name, clubName }: { teamId: number; name: string; clubName: string }) {
	const [editing, setEditing] = useState(false)
	const [draft, setDraft] = useState(name)
	const [error, setError] = useState<string | null>(null)
	const rename = useRenameTeam(teamId)

	async function submit(event: SubmitEvent<HTMLFormElement>) {
		event.preventDefault()
		setError(null)

		try {
			await rename.mutateAsync(draft.trim())
			setEditing(false)
		} catch (cause) {
			setError(cause instanceof ApiError ? cause.message : 'Přejmenování se nepodařilo.')
		}
	}

	if (!editing) {
		return (
			<Card className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
				<div className="min-w-0">
					<p className="truncate font-semibold">{name}</p>
					<p className="text-ink-faint truncate text-sm">{clubName}</p>
				</div>
				<Button
					size="sm"
					variant="ghost"
					onClick={() => {
						setDraft(name)
						setEditing(true)
					}}
				>
					Přejmenovat
				</Button>
			</Card>
		)
	}

	return (
		<Card className="px-4 py-3">
			<form onSubmit={submit} className="flex flex-col gap-3">
				<Field
					label="Název družstva"
					value={draft}
					onChange={(event) => setDraft(event.target.value)}
					required
					error={error ?? undefined}
				/>
				<div className="flex gap-2">
					<Button type="submit" size="sm" loading={rename.isPending}>
						Uložit
					</Button>
					<Button size="sm" variant="ghost" onClick={() => setEditing(false)}>
						Zrušit
					</Button>
				</div>
			</form>
		</Card>
	)
}
