import { useState } from 'react'

import { Avatar } from '@/components/ui/Avatar'
import { Button } from '@/components/ui/Button'
import { ConfirmDialog } from '@/components/ui/ConfirmDialog'
import { hasPlaceholderEmail, isLastAdmin, needsActivation, roleOrder } from '@/features/team/members'
import { cn } from '@/lib/cn'
import { formatPhone } from '@/lib/phone'
import type { MembershipChanges } from '@/lib/queries'
import type { Role, TeamMember } from '@/lib/types'
import { memberStatusLabels, roleLabels } from '@/lib/types'
import { emailError } from '@/lib/validation'

interface MemberRowProps {
	member: TeamMember
	members: TeamMember[]
	/** Přihlášený uživatel — sám sebe nesmí degradovat omylem, ptáme se ho zvlášť. */
	isMe: boolean
	busy: boolean
	onChange: (changes: MembershipChanges) => void
	onActivate: () => void
}

export function MemberRow({ member, members, isMe, busy, onChange, onActivate }: MemberRowProps) {
	const [expanded, setExpanded] = useState(false)
	const [confirmingLeave, setConfirmingLeave] = useState(false)
	const [confirmingSelfDemote, setConfirmingSelfDemote] = useState<Role | null>(null)

	const lastAdmin = isLastAdmin(member, members)
	const left = member.status === 'left'

	function changeRole(role: Role) {
		if (role === member.role) return

		// Degradace sebe sama je nevratná vlastními silami — dál už na tuhle
		// obrazovku nebude mít přístup.
		if (isMe && role !== 'admin' && member.role === 'admin') {
			setConfirmingSelfDemote(role)

			return
		}

		onChange({ role })
	}

	return (
		<div className="border-line/50 border-b last:border-b-0">
			<button
				type="button"
				onClick={() => setExpanded((value) => !value)}
				aria-expanded={expanded}
				className={cn(
					'flex w-full items-center gap-3 px-1 text-left',
					member.phone == null ? 'min-h-14 py-2' : 'min-h-12 pt-2',
				)}
			>
				<Avatar name={member.name} src={member.avatarUrl} jerseyNumber={member.jerseyNumber} size="sm" />
				<span className="min-w-0 flex-1">
					<span className="flex flex-wrap items-center gap-x-2 gap-y-1">
						<span className={cn('truncate font-medium', left && 'text-ink-faint')}>{member.name}</span>
						{member.jerseyNumber === null ? null : (
							<span className="text-ink-faint text-xs">#{member.jerseyNumber}</span>
						)}
						{needsActivation(member) ? (
							<span className="border-accent text-ink rounded-full border px-2 py-0.5 text-xs">bez hesla</span>
						) : null}
						{hasPlaceholderEmail(member) ? (
							<span className="bg-debt-500/15 text-debt rounded-full px-2 py-0.5 text-xs">bez e-mailu</span>
						) : null}
						{member.status === 'active' ? null : (
							<span className="bg-surface-2 text-ink-faint rounded-full px-2 py-0.5 text-xs">
								{memberStatusLabels[member.status]}
							</span>
						)}
					</span>
					<span className="text-ink-faint block truncate text-xs">{member.email}</span>
				</span>
				<span className="text-ink-muted shrink-0 text-xs">{roleLabels[member.role]}</span>
			</button>

			{member.phone == null ? null : (
				<a
					href={`tel:${member.phone}`}
					className="text-ink-faint ml-12 flex w-fit items-center pr-1 pb-2 text-xs underline"
				>
					{formatPhone(member.phone)}
				</a>
			)}

			{expanded ? (
				<div className="flex flex-col gap-3 px-1 pt-1 pb-4">
					<label className="flex flex-col gap-1.5">
						<span className="text-ink-muted text-sm font-medium">Jméno</span>
						<input
							type="text"
							disabled={busy}
							defaultValue={member.name}
							/* Ukládá se při opuštění pole, ne při každém písmenu. */
							onBlur={(event) => {
								const next = event.target.value.trim()

								if (next === '' || next === member.name) {
									event.target.value = member.name

									return
								}

								onChange({ name: next })
							}}
							className="border-line bg-surface-2 text-ink rounded-xl border px-3 py-2 text-base"
						/>
						<span className="text-ink-faint text-xs">
							Platí ve všech družstvech, kde hraje — jeden člověk má v klubu jedno jméno.
						</span>
					</label>

					<label className="flex flex-col gap-1.5">
						<span className="text-ink-muted text-sm font-medium">E-mail</span>
						<input
							type="email"
							inputMode="email"
							disabled={busy}
							defaultValue={member.email}
							/* Stejně jako jméno: ukládá se při opuštění pole. */
							onBlur={(event) => {
								const next = event.target.value.trim()

								if (next === member.email || emailError(next) !== undefined) {
									event.target.value = member.email

									return
								}

								onChange({ email: next })
							}}
							className="border-line bg-surface-2 text-ink rounded-xl border px-3 py-2 text-base"
						/>
						<span className="text-ink-faint text-xs">
							{hasPlaceholderEmail(member)
								? 'Zástupná adresa ze staré appky — dokud ji neopravíte, nepůjde vydat aktivační odkaz.'
								: 'Je to i přihlašovací adresa, platí pro celý účet napříč všemi jeho družstvy.'}
						</span>
					</label>

					<div className="flex flex-col gap-1.5">
						<span className="text-ink-muted text-sm font-medium">Role</span>
						<div className="border-line bg-surface-2 flex rounded-xl border p-1">
							{roleOrder.map((role) => {
								// Poslednímu adminovi nejde roli sebrat — server by stejně vrátil 409.
								const blocked = lastAdmin && role !== 'admin'

								return (
									<button
										key={role}
										type="button"
										disabled={busy || left || blocked}
										onClick={() => changeRole(role)}
										aria-pressed={member.role === role}
										className={cn(
											'min-h-9 flex-1 rounded-lg text-sm transition-colors disabled:opacity-40',
											member.role === role ? 'bg-brand-600 font-medium text-white' : 'text-ink-muted',
										)}
									>
										{roleLabels[role]}
									</button>
								)
							})}
						</div>
						{lastAdmin ? (
							<p className="text-ink-faint text-xs">
								Jediný admin družstva. Nejdřív jmenujte dalšího, teprve pak lze roli změnit.
							</p>
						) : null}
					</div>

					<label className="flex items-center gap-3">
						<span className="text-ink-muted text-sm font-medium">Číslo dresu</span>
						<input
							type="number"
							min={1}
							max={99}
							disabled={busy || left}
							defaultValue={member.jerseyNumber ?? ''}
							// Ukládá se až na onBlur — jinak by číslo „12" poslalo dva požadavky.
							onBlur={(event) => {
								const raw = event.target.value.trim()
								const next = raw === '' ? null : Number(raw)

								if (next === member.jerseyNumber) return
								if (next !== null && (!Number.isInteger(next) || next < 1 || next > 99)) return

								onChange({ jerseyNumber: next })
							}}
							className="border-line bg-surface-2 text-ink w-20 rounded-xl border px-3 py-2 text-base"
						/>
						<span className="text-ink-faint ml-auto text-xs">VS {member.paymentReference}</span>
					</label>

					<div className="flex flex-wrap gap-2">
						{needsActivation(member) ? (
							<Button size="sm" variant="accent" loading={busy} onClick={onActivate}>
								Aktivační odkaz
							</Button>
						) : null}

						{left ? (
							<Button size="sm" variant="ghost" disabled={busy} onClick={() => onChange({ status: 'active' })}>
								Vrátit do družstva
							</Button>
						) : (
							<Button size="sm" variant="danger" disabled={busy || lastAdmin} onClick={() => setConfirmingLeave(true)}>
								Odešel
							</Button>
						)}
					</div>
				</div>
			) : null}

			<ConfirmDialog
				open={confirmingLeave}
				title={`Označit ${member.name} za odešlého?`}
				description="Zmizí z nabídky pro soupisky a přestane se mu zapisovat. Zapsané dluhy i historie zůstávají — vrátit ho jde kdykoli."
				confirmLabel="Označit"
				danger
				onConfirm={() => {
					onChange({ status: 'left' })
					setConfirmingLeave(false)
				}}
				onCancel={() => setConfirmingLeave(false)}
			/>

			<ConfirmDialog
				open={confirmingSelfDemote !== null}
				title="Vzdát se role admina?"
				description="Tuhle stránku pak neotevřete a roli si zpátky nevrátíte — musel by vám ji vrátit jiný admin."
				confirmLabel="Vzdát se"
				danger
				onConfirm={() => {
					if (confirmingSelfDemote !== null) onChange({ role: confirmingSelfDemote })
					setConfirmingSelfDemote(null)
				}}
				onCancel={() => setConfirmingSelfDemote(null)}
			/>
		</div>
	)
}
