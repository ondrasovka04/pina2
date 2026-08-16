import type { SubmitEvent } from 'react'
import { useState } from 'react'

import { useCurrentUser } from '@/app/session'
import { Button } from '@/components/ui/Button'
import { Field } from '@/components/ui/Field'
import { roleOrder } from '@/features/team/members'
import { ApiError } from '@/lib/api'
import { cn } from '@/lib/cn'
import { useInvitations, useInviteMember, useResendInvitation, useRevokeInvitation } from '@/lib/queries'
import type { IssuedLink, Role } from '@/lib/types'
import { formatDateTime, roleLabels } from '@/lib/types'
import { emailError } from '@/lib/validation'

interface InvitationsSectionProps {
	teamId: number
	onIssued: (link: IssuedLink) => void
}

/**
 * Pozvání nového člověka a přehled nevyzvednutých pozvánek.
 * Sekce je sbalená — dotaz se pouští až po rozbalení.
 */
export function InvitationsSection({ teamId, onIssued }: InvitationsSectionProps) {
	const { mailEnabled } = useCurrentUser()
	const [open, setOpen] = useState(false)
	const [email, setEmail] = useState('')
	const [role, setRole] = useState<Role>('player')
	const [sendEmail, setSendEmail] = useState(true)
	const [error, setError] = useState<string | null>(null)

	const pending = useInvitations(teamId, open)
	const invite = useInviteMember(teamId)
	const resend = useResendInvitation(teamId)
	const revoke = useRevokeInvitation(teamId)

	async function submit(event: SubmitEvent<HTMLFormElement>) {
		event.preventDefault()

		const invalid = emailError(email)
		if (invalid !== undefined) {
			setError(invalid)

			return
		}

		setError(null)

		try {
			const result = await invite.mutateAsync({ email: email.trim(), role, sendEmail: sendEmail && mailEnabled })
			setEmail('')
			onIssued(result.invitation)
		} catch (cause) {
			setError(cause instanceof ApiError ? cause.message : 'Pozvánku se nepodařilo vytvořit.')
		}
	}

	const invitations = pending.data ?? []

	return (
		<details
			open={open}
			onToggle={(event) => setOpen(event.currentTarget.open)}
			className="border-line bg-surface-1 overflow-hidden rounded-2xl border"
		>
			<summary className="cursor-pointer px-4 py-3 font-medium select-none">
				Pozvat nového člena
				{invitations.length === 0 ? null : (
					<span className="text-ink-faint ml-2 text-sm font-normal">({invitations.length} čeká)</span>
				)}
			</summary>

			<div className="border-line/60 flex flex-col gap-4 border-t px-4 py-4">
				{/* noValidate: hlášku si vypisujeme sami česky, viz lib/validation.ts */}
				<form onSubmit={submit} noValidate className="flex flex-col gap-3">
					<Field
						label="E-mail"
						type="email"
						value={email}
						onChange={(event) => {
							setEmail(event.target.value)
							setError(null)
						}}
						autoComplete="off"
						autoCapitalize="off"
						inputMode="email"
						error={error ?? undefined}
						hint={
							mailEnabled
								? 'Odkaz uvidíte i po odeslání — kdyby zpráva skončila ve spamu, pošlete ho ručně.'
								: 'Odesílání e-mailů je vypnuté. Vytvoří se odkaz, který pozvanému pošlete do chatu.'
						}
					/>

					{mailEnabled ? (
						<label className="flex min-h-11 items-center gap-3">
							<input
								type="checkbox"
								className="size-5 shrink-0"
								checked={sendEmail}
								onChange={(event) => setSendEmail(event.target.checked)}
							/>
							<span className="text-sm">Poslat pozvánku e-mailem</span>
						</label>
					) : null}

					<div className="flex flex-col gap-1.5">
						<span className="text-ink-muted text-sm font-medium">Role</span>
						<div className="border-line bg-surface-2 flex rounded-xl border p-1">
							{roleOrder.map((option) => (
								<button
									key={option}
									type="button"
									onClick={() => setRole(option)}
									aria-pressed={role === option}
									className={cn(
										'min-h-9 flex-1 rounded-lg text-sm transition-colors',
										role === option ? 'bg-brand-600 font-medium text-white' : 'text-ink-muted',
									)}
								>
									{roleLabels[option]}
								</button>
							))}
						</div>
					</div>

					<Button type="submit" loading={invite.isPending}>
						Vytvořit pozvánku
					</Button>
				</form>

				{invitations.length === 0 ? null : (
					<div className="flex flex-col gap-1">
						<p className="text-ink-muted text-sm font-medium">Nevyzvednuté pozvánky</p>
						<div className="divide-line/50 divide-y">
							{invitations.map((invitation) => (
								<div key={invitation.id} className="flex items-center gap-3 py-2">
									<span className="min-w-0 flex-1">
										<span className="block truncate text-sm">{invitation.email}</span>
										<span className={cn('block text-xs', invitation.expired ? 'text-debt' : 'text-ink-faint')}>
											{roleLabels[invitation.role]} ·{' '}
											{invitation.expired ? 'platnost vypršela' : `platí do ${formatDateTime(invitation.expiresAt)}`}
										</span>
									</span>
									{mailEnabled ? (
										<Button
											size="sm"
											variant="ghost"
											loading={resend.isPending && resend.variables === invitation.id}
											onClick={() => {
												setError(null)
												resend.mutate(invitation.id, {
													onSuccess: (result) => onIssued(result.invitation),
													onError: (cause) => {
														setError(cause instanceof ApiError ? cause.message : 'Odeslání selhalo.')
													},
												})
											}}
										>
											Poslat znovu
										</Button>
									) : null}
									<Button
										size="sm"
										variant="ghost"
										loading={revoke.isPending && revoke.variables === invitation.id}
										onClick={() => revoke.mutate(invitation.id)}
									>
										Zrušit
									</Button>
								</div>
							))}
						</div>
					</div>
				)}
			</div>
		</details>
	)
}
