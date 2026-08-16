import { useState } from 'react'
import { Link, useNavigate } from 'react-router'

import { useTeam } from '@/app/team'
import { Button } from '@/components/ui/Button'
import { Card } from '@/components/ui/Card'
import { ConfirmDialog } from '@/components/ui/ConfirmDialog'
import { EmptyState, ErrorState, LoadingState } from '@/components/ui/States'
import { players } from '@/lib/plural'
import { useCloseSeason, useRoster, useSaveRoster, useSeasons, useTeamMembers } from '@/lib/queries'
import type { RosterEntry, Season, TeamMember } from '@/lib/types'
import { formatDate, roleLabels } from '@/lib/types'

type RosterQuery = ReturnType<typeof useRoster>
type MembersQuery = ReturnType<typeof useTeamMembers>

export function SeasonsPage() {
	const { team, can, selectSeason } = useTeam()
	const navigate = useNavigate()
	const isAdmin = can('admin')

	const { data, isPending, error, refetch } = useSeasons(team?.id ?? null)
	const seasons = data ?? []

	// Soupiska jen pro jednu rozbalenou sezónu — hooky se nesmí volat v cyklu
	const [openSeasonId, setOpenSeasonId] = useState<number | null>(null)
	const roster = useRoster(openSeasonId)
	const members = useTeamMembers(team?.id ?? null)
	const saveRoster = useSaveRoster(team?.id ?? 0)
	const closeSeason = useCloseSeason(team?.id ?? 0)

	if (!isAdmin) {
		return (
			<EmptyState
				title="Sezóny spravuje admin"
				description="Zakládání a uzavírání sezón má na starosti admin družstva. Pro přístup k téhle stránce ho poproste."
			/>
		)
	}

	if (isPending) return <LoadingState />
	if (error !== null) return <ErrorState error={error} onRetry={() => void refetch()} />

	if (seasons.length === 0) {
		return (
			<EmptyState
				title="Družstvo zatím nemá žádnou sezónu"
				description="První sezónu založíte průvodcem „Nová sezóna”."
			/>
		)
	}

	return (
		<div className="flex flex-col gap-4">
			<div className="flex items-center justify-between gap-3">
				<h1 className="text-lg font-semibold">Sezóny</h1>
				<Link
					to="/sezony/nova"
					role="button"
					className="bg-accent text-on-accent inline-flex min-h-11 items-center rounded-xl px-4 text-sm font-semibold"
				>
					Nová sezóna
				</Link>
			</div>

			{seasons.map((season) => (
				<SeasonCard
					key={season.id}
					season={season}
					isOpen={openSeasonId === season.id}
					onToggleOpen={(open) => setOpenSeasonId(open ? season.id : null)}
					onView={() => {
						selectSeason(season.id)
						void navigate('/dluhy')
					}}
					onClose={() => closeSeason.mutate(season.id)}
					closing={closeSeason.isPending && closeSeason.variables === season.id}
					roster={roster}
					members={members}
					onSaveRoster={(membershipIds) => saveRoster.mutateAsync({ seasonId: season.id, membershipIds })}
				/>
			))}
		</div>
	)
}

interface SeasonCardProps {
	season: Season
	isOpen: boolean
	onToggleOpen: (open: boolean) => void
	onView: () => void
	onClose: () => void
	closing: boolean
	roster: RosterQuery
	members: MembersQuery
	onSaveRoster: (membershipIds: number[]) => Promise<unknown>
}

function SeasonCard({
	season,
	isOpen,
	onToggleOpen,
	onView,
	onClose,
	closing,
	roster,
	members,
	onSaveRoster,
}: SeasonCardProps) {
	const [confirmingClose, setConfirmingClose] = useState(false)
	const closed = season.closedAt !== null

	return (
		<Card className="overflow-hidden">
			<div className="flex flex-wrap items-start justify-between gap-3 px-4 py-3">
				<div className="min-w-0">
					<div className="flex flex-wrap items-center gap-2">
						<h2 className="truncate font-semibold">{season.name}</h2>
						{season.isCurrent ? (
							<span className="border-accent bg-accent/10 text-ink rounded-full border px-2 py-0.5 text-xs font-medium">
								probíhá
							</span>
						) : null}
						{closed ? (
							<span className="bg-surface-2 text-ink-faint rounded-full px-2 py-0.5 text-xs font-medium">uzavřená</span>
						) : null}
					</div>
					<p className="text-ink-muted mt-0.5 text-sm">
						{formatDate(season.startsOn)} – {formatDate(season.endsOn)}
					</p>
					<p className="text-ink-muted text-sm">{players(season.rosterCount)} na soupisce</p>
				</div>

				<div className="flex shrink-0 gap-2">
					<Button size="sm" variant="ghost" onClick={onView}>
						Zobrazit
					</Button>
					{closed ? null : (
						<Button size="sm" variant="danger" loading={closing} onClick={() => setConfirmingClose(true)}>
							Uzavřít
						</Button>
					)}
				</div>
			</div>

			<details
				open={isOpen}
				onToggle={(event) => onToggleOpen(event.currentTarget.open)}
				className="border-line/60 border-t"
			>
				<summary className="cursor-pointer px-4 py-3 text-sm font-medium select-none">Soupiska</summary>
				<div className="border-line/60 border-t px-4 py-3">
					{isOpen ? <RosterSection closed={closed} roster={roster} members={members} onSave={onSaveRoster} /> : null}
				</div>
			</details>

			<ConfirmDialog
				open={confirmingClose}
				title={`Uzavřít sezónu „${season.name}"?`}
				description="Do uzavřené sezóny se pak nedá nic zapsat ani stornovat. Zpátky ji z aplikace neotevřete."
				confirmLabel="Uzavřít"
				danger
				onConfirm={() => {
					onClose()
					setConfirmingClose(false)
				}}
				onCancel={() => setConfirmingClose(false)}
			/>
		</Card>
	)
}

function RosterSection({
	closed,
	roster,
	members,
	onSave,
}: {
	closed: boolean
	roster: RosterQuery
	members: MembersQuery
	onSave: (membershipIds: number[]) => Promise<unknown>
}) {
	if (roster.isPending || (!closed && members.isPending)) return <LoadingState />
	if (roster.error !== null) return <ErrorState error={roster.error} onRetry={() => void roster.refetch()} />
	if (!closed && members.error !== null) {
		return <ErrorState error={members.error} onRetry={() => void members.refetch()} />
	}

	const rosterEntries = roster.data ?? []

	if (closed) return <RosterReadOnly roster={rosterEntries} />

	return <RosterEditor members={members.data ?? []} roster={rosterEntries} onSave={onSave} />
}

function RosterReadOnly({ roster }: { roster: RosterEntry[] }) {
	if (roster.length === 0) return <p className="text-ink-muted text-sm">Soupiska je prázdná.</p>

	return (
		<div className="divide-line/50 divide-y">
			{roster.map((entry) => (
				<div key={entry.membershipId} className="flex items-center gap-3 py-2 text-sm">
					<span className="min-w-0 flex-1 truncate">
						{entry.name}
						{entry.jerseyNumber === null ? null : ` · #${entry.jerseyNumber}`}
					</span>
					<span className="text-ink-faint shrink-0 text-xs">{roleLabels[entry.role]}</span>
				</div>
			))}
		</div>
	)
}

function RosterEditor({
	members,
	roster,
	onSave,
}: {
	members: TeamMember[]
	roster: RosterEntry[]
	onSave: (membershipIds: number[]) => Promise<unknown>
}) {
	// Výchozí výběr je aktuální soupiska. Komponenta se remountuje při přepnutí
	// rozbalené sezóny (viz `key` u volání níž), takže se stav pokaždé srovná
	// s čerstvě načtenou soupiskou dané sezóny.
	const [selected, setSelected] = useState<Set<number>>(() => new Set(roster.map((entry) => entry.membershipId)))

	// Kdo odešel, ale zůstal na soupisce, musí jít pořád odškrtnout — jinak by
	// uložení tichem smazalo jeho místo, aniž by to admin viděl.
	const rosterIds = new Set(roster.map((entry) => entry.membershipId))
	/*
	 * Nahoře jsou lidé, kteří na soupisce už jsou. Řadí se podle *načtené*
	 * soupisky, ne podle zaškrtnutí — jinak by řádky poskakovaly pod rukou,
	 * jak by se odškrtávalo.
	 */
	const candidates = members
		.filter((member) => member.status !== 'left' || rosterIds.has(member.id))
		.toSorted((a, b) => {
			const byRoster = Number(rosterIds.has(b.id)) - Number(rosterIds.has(a.id))

			return byRoster === 0 ? a.name.localeCompare(b.name, 'cs') : byRoster
		})

	/**
	 * Ukládá se celá soupiska naráz, ne každé zaškrtnutí zvlášť — server ji
	 * nahrazuje jedním požadavkem. Tlačítko proto musí umět říct, že je hotovo,
	 * jinak člověk neví, jestli se něco stalo.
	 */
	const [status, setStatus] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle')

	function toggle(id: number) {
		setStatus('idle')
		setSelected((current) => {
			const next = new Set(current)
			if (next.has(id)) next.delete(id)
			else next.add(id)

			return next
		})
	}

	async function save() {
		setStatus('saving')

		try {
			await onSave([...selected])
			setStatus('saved')
		} catch {
			setStatus('error')
		}
	}

	return (
		<div className="flex flex-col gap-3">
			<div className="flex items-center justify-between gap-3">
				<p className="text-ink-muted text-sm">
					{players(selected.size)} vybráno
					{status === 'saved' ? <span className="text-bonus ml-2">· uloženo</span> : null}
					{status === 'error' ? <span className="text-debt ml-2">· uložení selhalo</span> : null}
				</p>
				<Button size="sm" loading={status === 'saving'} onClick={() => void save()}>
					Uložit soupisku
				</Button>
			</div>

			{candidates.length === 0 ? (
				<p className="text-ink-muted text-sm">Družstvo zatím nemá žádného člena k zařazení.</p>
			) : (
				<div className="divide-line/50 divide-y">
					{candidates.map((member) => (
						<label key={member.id} className="flex min-h-11 cursor-pointer items-center gap-3 py-2">
							<input
								type="checkbox"
								className="size-5 shrink-0"
								checked={selected.has(member.id)}
								onChange={() => toggle(member.id)}
							/>
							<span className="min-w-0 flex-1 truncate text-sm">
								{member.name}
								{member.jerseyNumber === null ? null : ` · #${member.jerseyNumber}`}
							</span>
							<span className="text-ink-faint shrink-0 text-xs">{roleLabels[member.role]}</span>
						</label>
					))}
				</div>
			)}
		</div>
	)
}
