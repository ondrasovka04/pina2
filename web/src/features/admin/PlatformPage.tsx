import type { SubmitEvent } from 'react'
import { useState } from 'react'

import { useCurrentUser } from '@/app/session'
import { Button } from '@/components/ui/Button'
import { Card } from '@/components/ui/Card'
import { Field } from '@/components/ui/Field'
import { EmptyState, ErrorState, LoadingState } from '@/components/ui/States'
import { TeamRescue } from '@/features/admin/TeamRescue'
import { ApiError } from '@/lib/api'
import { cn } from '@/lib/cn'
import { plural } from '@/lib/plural'
import { useCreateClub, useCreateTeam, usePlatformClubs } from '@/lib/queries'
import type { PlatformClub, PlatformTeam } from '@/lib/types'

/**
 * Provozní konzole — jen oprávnění pro admina bez admina a vydávání odkázů.
 * Ostatní peníze a konfiguraci spravuje admin klubu.
 */
export function PlatformPage() {
	const me = useCurrentUser()
	const { data, isPending, error, refetch } = usePlatformClubs(me.platformAdmin)

	if (!me.platformAdmin) {
		return (
			<EmptyState
				title="Tahle část patří správci platformy"
				description="Spravuje kluby a zakládá nová družstva. Svoje družstvo najdete pod „Spravovat družstva”."
			/>
		)
	}

	if (isPending) {
		return <LoadingState />
	}
	if (error !== null) {
		return <ErrorState error={error} onRetry={() => void refetch()} />
	}

	const clubs = data ?? []

	return (
		<div className="flex flex-col gap-4">
			<div>
				<h1 className="text-lg font-semibold">Správa platformy</h1>
				<p className="text-ink-muted mt-1 text-sm">
					{plural(clubs.length, 'klub', 'kluby', 'klubů')} · dluhy cizích klubů se tu nezobrazují
				</p>
			</div>

			{clubs.map((club) => (
				<ClubCard key={club.id} club={club} />
			))}

			<NewClubCard />
		</div>
	)
}

function ClubCard({ club }: { club: PlatformClub }) {
	return (
		<Card className="overflow-hidden">
			<div className="flex flex-wrap items-baseline justify-between gap-2 px-4 py-3">
				<h2 className="font-semibold">{club.name}</h2>
				<p className="text-ink-faint text-sm">{plural(club.teams.length, 'družstvo', 'družstva', 'družstev')}</p>
			</div>

			<div className="border-line/60 divide-line/50 divide-y border-t">
				{club.teams.map((team) => (
					<TeamRow key={team.id} team={team} />
				))}
			</div>

			<NewTeamForm clubId={club.id} clubName={club.name} />
		</Card>
	)
}

function TeamRow({ team }: { team: PlatformTeam }) {
	const [open, setOpen] = useState(false)

	// Družstvo bez admina se samo nespraví: roli uděluje admin téhož družstva.
	const stranded = team.adminCount === 0
	const locked = team.activatedCount === 0 && team.memberCount > 0

	return (
		<div>
			<button
				type="button"
				onClick={() => setOpen((value) => !value)}
				aria-expanded={open}
				className="flex min-h-14 w-full flex-wrap items-center justify-between gap-x-3 gap-y-1 px-4 py-2 text-left"
			>
				<span className="min-w-0">
					<span className="flex flex-wrap items-center gap-2">
						<span className="truncate font-medium">{team.name}</span>
						{team.archived ? (
							<span className="bg-surface-2 text-ink-faint rounded-full px-2 py-0.5 text-xs">archivované</span>
						) : null}
						{stranded ? <Badge tone="bad">bez admina</Badge> : null}
						{locked ? <Badge tone="warn">nikdo se nepřihlásil</Badge> : null}
					</span>
					<span className="text-ink-faint block text-xs">
						{plural(team.memberCount, 'člen', 'členové', 'členů')} · {team.activatedCount} s heslem ·{' '}
						{team.currentSeason ?? 'bez sezóny'}
					</span>
				</span>
				<span className="text-ink-muted shrink-0 text-sm">{open ? 'Skrýt' : 'Spravovat'}</span>
			</button>

			{open ? <TeamRescue teamId={team.id} teamName={team.name} /> : null}
		</div>
	)
}

function Badge({ tone, children }: { tone: 'bad' | 'warn'; children: string }) {
	return (
		<span
			className={cn(
				'rounded-full border px-2 py-0.5 text-xs',
				tone === 'bad' ? 'border-debt-500 text-debt' : 'border-accent text-ink',
			)}
		>
			{children}
		</span>
	)
}

function NewTeamForm({ clubId, clubName }: { clubId: number; clubName: string }) {
	const [name, setName] = useState('')
	const [error, setError] = useState<string | null>(null)
	const create = useCreateTeam(clubId)

	async function submit(event: SubmitEvent<HTMLFormElement>) {
		event.preventDefault()
		setError(null)

		try {
			await create.mutateAsync({ name: name.trim() })
			setName('')
		} catch (cause) {
			setError(cause instanceof ApiError ? cause.message : 'Družstvo se nepodařilo založit.')
		}
	}

	return (
		<form onSubmit={submit} noValidate className="border-line/60 flex flex-wrap items-end gap-2 border-t px-4 py-3">
			<div className="min-w-48 flex-1">
				<Field
					label="Nové družstvo"
					value={name}
					onChange={(event) => {
						setName(event.target.value)
						setError(null)
					}}
					placeholder={`Družstvo v klubu ${clubName}`}
					error={error ?? undefined}
					hint="Zakladatel se stává jeho adminem — tedy vy, dokud roli nepředáte."
				/>
			</div>
			<Button type="submit" size="sm" loading={create.isPending} disabled={name.trim() === ''}>
				Založit
			</Button>
		</form>
	)
}

function NewClubCard() {
	const [name, setName] = useState('')
	const [error, setError] = useState<string | null>(null)
	const create = useCreateClub()

	async function submit(event: SubmitEvent<HTMLFormElement>) {
		event.preventDefault()
		setError(null)

		try {
			await create.mutateAsync(name.trim())
			setName('')
		} catch (cause) {
			setError(cause instanceof ApiError ? cause.message : 'Klub se nepodařilo založit.')
		}
	}

	return (
		<Card className="px-4 py-3">
			<form onSubmit={submit} noValidate className="flex flex-wrap items-end gap-2">
				<div className="min-w-48 flex-1">
					<Field
						label="Nový klub"
						value={name}
						onChange={(event) => {
							setName(event.target.value)
							setError(null)
						}}
						placeholder="VK Kbely"
						error={error ?? undefined}
						hint="Klub vzniká prázdný. Hned potom mu založte první družstvo."
					/>
				</div>
				<Button type="submit" size="sm" loading={create.isPending} disabled={name.trim() === ''}>
					Založit klub
				</Button>
			</form>
		</Card>
	)
}
