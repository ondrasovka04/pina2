import type { SubmitEvent } from 'react'
import { useState } from 'react'

import { useCurrentUser, useSession } from '@/app/session'
import { useTeam } from '@/app/team'
import { useTheme } from '@/app/theme'
import { Button } from '@/components/ui/Button'
import { Card, CardHeader } from '@/components/ui/Card'
import { Field } from '@/components/ui/Field'
import { ImageUpload } from '@/components/ui/ImageUpload'
import { Money } from '@/components/ui/Money'
import { api, ApiError } from '@/lib/api'
import { cn } from '@/lib/cn'
import type { TeamDebt } from '@/lib/queries'
import { useMyDebts, useSaveUserImage } from '@/lib/queries'
import type { ThemePreference } from '@/lib/theme'
import { themeLabels } from '@/lib/theme'
import type { Membership } from '@/lib/types'
import { roleLabels } from '@/lib/types'

import { AppInstallCard } from './AppInstallCard'
import { CalendarFeedsCard } from './CalendarFeedsCard'
import { NotificationsCard } from './NotificationsCard'
import { PhoneCard } from './PhoneCard'

export function ProfilePage() {
	const user = useCurrentUser()
	const { signOut } = useSession()
	const { teams } = useTeam()
	const usesAnyAttendance = teams.some((team) => team.attendanceEnabled)

	return (
		<div className="flex flex-col gap-4">
			<div>
				<h1 className="text-lg font-semibold">{user.name}</h1>
				<p className="text-ink-muted text-sm">{user.email}</p>
			</div>

			<ProfileImageCard />

			<PhoneCard />

			<MyTeamsCard />

			<AppInstallCard />

			<NotificationsCard />

			{usesAnyAttendance ? <CalendarFeedsCard /> : null}

			<AppearanceCard />

			<PasswordCard />

			<Card className="flex flex-col gap-3 p-4">
				<Button variant="ghost" fullWidth onClick={() => void signOut()}>
					Odhlásit se
				</Button>
				<LogoutEverywhereButton />
			</Card>
		</div>
	)
}

function ProfileImageCard() {
	const user = useCurrentUser()
	const { refreshUser } = useSession()
	const save = useSaveUserImage()

	return (
		<Card>
			<CardHeader title="Profilový obrázek" />
			<div className="p-4">
				<ImageUpload
					name={user.name}
					imageUrl={user.avatarUrl}
					onSave={async (image) => {
						await save.mutateAsync(image)
						// Uloženo je uloženo. Když se pak nepovede načíst `/me`, není to
						// chyba ukládání — hlásit ji by znamenalo tvrdit, že obrázek
						// nevznikl, a on přitom na serveru je.
						await refreshUser().catch(() => undefined)
					}}
				/>
			</div>
		</Card>
	)
}

// Dluhy v každém týmu — vedle sebe, ne po přepnutí
function MyTeamsCard() {
	const user = useCurrentUser()
	const { teams } = useTeam()
	const { debts, isPending } = useMyDebts(teams)

	const debtByTeam = new Map(debts.map((debt) => [debt.teamId, debt]))

	return (
		<Card>
			<CardHeader title="Moje týmy" />
			<div className="divide-line/50 divide-y">
				{user.memberships.map((membership) => (
					<MembershipRow
						key={membership.id}
						membership={membership}
						debt={debtByTeam.get(membership.teamId) ?? null}
						loading={isPending}
					/>
				))}
			</div>
		</Card>
	)
}

function MembershipRow({
	membership,
	debt,
	loading,
}: {
	membership: Membership
	debt: TeamDebt | null
	loading: boolean
}) {
	const balanceCzk = debt?.balanceCzk ?? null
	const seasonName = debt?.seasonName ?? null

	return (
		<div className="flex items-center justify-between gap-3 px-4 py-3 first:rounded-t-2xl last:rounded-b-2xl">
			<div className="min-w-0">
				<p className="truncate font-medium">{membership.teamName}</p>
				<p className="text-ink-faint truncate text-xs">
					{membership.clubName} · {roleLabels[membership.role]}
				</p>
				<p className="text-ink-faint mt-1 truncate text-xs">
					VS <span className="tabular text-accent font-medium">{membership.paymentReference}</span>
				</p>
			</div>

			<div className="shrink-0 text-right">
				{balanceCzk === null ? (
					/*
					 * Dvě různé situace vypadaly stejně: družstvo nemá rozjetou
					 * sezónu × sezóna běží, ale já na její soupisce nejsem.
					 * „Bez sezóny" v druhém případě lhalo.
					 */
					<p className="text-ink-faint text-sm">
						{loading ? '…' : seasonName === null ? 'bez sezóny' : 'nejste na soupisce'}
					</p>
				) : (
					<>
						<p className="text-lg font-semibold">
							<Money czk={balanceCzk} tone="balance" />
						</p>
						<p className="text-ink-faint text-xs">{seasonName}</p>
					</>
				)}
			</div>
		</div>
	)
}

/**
 * Volba motivu. Výchozí „podle systému" je záměr: telefon přepíná na tmavý
 * podle času a aplikace ho má následovat. Ruční volba je tu pro ty, komu to
 * nesedí — třeba v hale s ostrým světlem.
 */
function AppearanceCard() {
	const { preference, setPreference } = useTheme()
	const options: ThemePreference[] = ['system', 'light', 'dark']

	return (
		<Card>
			<CardHeader title="Vzhled" />
			<div className="flex gap-2 p-4">
				{options.map((option) => (
					<button
						key={option}
						type="button"
						onClick={() => setPreference(option)}
						aria-pressed={preference === option}
						className={cn(
							'flex-1 rounded-xl border px-3 text-sm transition-colors',
							preference === option
								? 'border-accent bg-accent/10 text-ink font-medium'
								: 'border-line bg-surface-2 text-ink-muted',
						)}
					>
						{themeLabels[option]}
					</button>
				))}
			</div>
		</Card>
	)
}

type PasswordField = 'currentPassword' | 'newPassword' | 'newPassword2'

function isPasswordField(value: string): value is PasswordField {
	return value === 'currentPassword' || value === 'newPassword' || value === 'newPassword2'
}

function PasswordCard() {
	const { signOut } = useSession()

	const [currentPassword, setCurrentPassword] = useState('')
	const [newPassword, setNewPassword] = useState('')
	const [newPassword2, setNewPassword2] = useState('')
	const [errors, setErrors] = useState<Partial<Record<PasswordField, string>>>({})
	const [generalError, setGeneralError] = useState<string | null>(null)
	const [submitting, setSubmitting] = useState(false)
	const [done, setDone] = useState(false)

	async function handleSubmit(event: SubmitEvent<HTMLFormElement>) {
		event.preventDefault()
		setErrors({})
		setGeneralError(null)

		if (newPassword !== newPassword2) {
			setErrors({ newPassword2: 'Hesla se neshodují.' })
			return
		}

		setSubmitting(true)

		try {
			await api.post('/auth/password', { currentPassword, newPassword })
			setDone(true)
			// Server po změně zneplatní všechny relace — necháme uživatele chvíli
			// vidět potvrzení, než ho odhlásíme.
			window.setTimeout(() => void signOut(), 1500)
		} catch (cause) {
			if (cause instanceof ApiError && cause.field !== undefined && isPasswordField(cause.field)) {
				setErrors({ [cause.field]: cause.message })
			} else if (cause instanceof ApiError) {
				setGeneralError(cause.message)
			} else {
				setGeneralError('Změna hesla se nepodařila. Zkuste to prosím znovu.')
			}
			setSubmitting(false)
		}
	}

	if (done) {
		return (
			<Card>
				<CardHeader title="Změna hesla" />
				<p className="text-ink-muted px-4 py-6 text-sm">
					Heslo je změněné. Za chvíli vás odhlásíme ze všech zařízení — přihlaste se pak znovu novým heslem.
				</p>
			</Card>
		)
	}

	return (
		<Card>
			<CardHeader title="Změna hesla" subtitle="Po uložení vás odhlásíme ze všech zařízení — přihlaste se pak znovu." />
			<form onSubmit={(event) => void handleSubmit(event)} className="flex flex-col gap-4 p-4">
				<Field
					label="Současné heslo"
					type="password"
					autoComplete="current-password"
					value={currentPassword}
					onChange={(event) => setCurrentPassword(event.target.value)}
					error={errors.currentPassword}
					required
				/>
				<Field
					label="Nové heslo"
					type="password"
					autoComplete="new-password"
					value={newPassword}
					onChange={(event) => setNewPassword(event.target.value)}
					error={errors.newPassword}
					required
				/>
				<Field
					label="Nové heslo znovu"
					type="password"
					autoComplete="new-password"
					value={newPassword2}
					onChange={(event) => setNewPassword2(event.target.value)}
					error={errors.newPassword2}
					required
				/>

				{generalError === null ? null : (
					<p role="alert" className="bg-debt-500/15 text-debt rounded-xl px-3 py-2 text-sm">
						{generalError}
					</p>
				)}

				<Button type="submit" loading={submitting}>
					Změnit heslo
				</Button>
			</form>
		</Card>
	)
}

function LogoutEverywhereButton() {
	const { signOut } = useSession()
	const [loading, setLoading] = useState(false)

	async function handleClick() {
		setLoading(true)

		try {
			await api.post('/auth/logout-everywhere')
		} catch {
			// I když volání selže, lokálně se stejně odhlásíme — jde o ztracený telefon.
		} finally {
			await signOut()
		}
	}

	return (
		<div>
			<Button variant="ghost" fullWidth loading={loading} onClick={() => void handleClick()}>
				Odhlásit ze všech zařízení
			</Button>
			<p className="text-ink-faint mt-1.5 text-center text-xs">Hodí se, když ztratíte telefon.</p>
		</div>
	)
}
