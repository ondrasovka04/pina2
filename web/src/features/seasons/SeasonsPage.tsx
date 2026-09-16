import { useRef, useState } from 'react'
import { Link, useNavigate } from 'react-router'

import { useTeam } from '@/app/team'
import { Avatar } from '@/components/ui/Avatar'
import { Button } from '@/components/ui/Button'
import { Card } from '@/components/ui/Card'
import { ConfirmDialog } from '@/components/ui/ConfirmDialog'
import { EmptyState, ErrorState, LoadingState } from '@/components/ui/States'
import { ApiError } from '@/lib/api'
import { players } from '@/lib/plural'
import { useCloseSeason, useRoster, useSaveRoster, useSeasons, useSetHalfYear, useTeamMembers } from '@/lib/queries'
import type { RosterEntry, Season, TeamMember } from '@/lib/types'
import { formatDate, roleLabels } from '@/lib/types'

type RosterQuery = ReturnType<typeof useRoster>
type MembersQuery = ReturnType<typeof useTeamMembers>

export function SeasonsPage() {
	const { team, can, selectSeason } = useTeam()
	const navigate = useNavigate()
	// Soupisku mění i pínař — od ní se odvíjí přehled dluhů. Zakládat a uzavírat
	// sezónu smí jen admin: uzavření je z aplikace nevratné a zamkne všechny zápisy.
	const canRoster = can('treasurer')
	const isAdmin = can('admin')

	const { data, isPending, error, refetch } = useSeasons(team?.id ?? null)
	const seasons = data ?? []

	// Soupiska jen pro jednu rozbalenou sezónu — hooky se nesmí volat v cyklu
	const [openSeasonId, setOpenSeasonId] = useState<number | null>(null)
	const roster = useRoster(openSeasonId)
	const members = useTeamMembers(team?.id ?? null)
	const saveRoster = useSaveRoster(team?.id ?? 0)
	const closeSeason = useCloseSeason(team?.id ?? 0)

	if (!canRoster) {
		return (
			<EmptyState
				title="Sezóny spravuje pínař nebo admin"
				description="Soupisku mění pínař, zakládat a uzavírat sezóny smí admin. Kdo tuhle roli má, uvidíte na obrazovce družstva."
			/>
		)
	}

	if (isPending) {
		return <LoadingState />
	}
	if (error !== null) {
		return <ErrorState error={error} onRetry={() => void refetch()} />
	}

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
				{isAdmin ? (
					<Link
						to="/sezony/nova"
						role="button"
						className="bg-accent text-on-accent inline-flex min-h-11 items-center rounded-xl px-4 text-sm font-semibold"
					>
						Nová sezóna
					</Link>
				) : null}
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
					isAdmin={isAdmin}
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

/**
 * Datum, kterým se sezóna dělí na pololetí. Ukládá se při každé změně, stejně
 * jako soupiska — jedno pole si tlačítko nezaslouží. Vyprázdněním se pololetí
 * vypne; nic se tím nezamyká, jen se přestanou dělit čísla na obrazovkách peněz.
 */
function HalfYearField({ season }: { season: Season }) {
	const { team } = useTeam()
	const save = useSetHalfYear(team?.id ?? 0)
	const [error, setError] = useState<string | null>(null)

	function change(value: string) {
		setError(null)
		save.mutate(
			{ seasonId: season.id, halfYearOn: value === '' ? null : value },
			{
				onError: (cause) =>
					setError(cause instanceof ApiError ? cause.message : 'Přelom pololetí se nepodařilo uložit.'),
			},
		)
	}

	return (
		<div className="border-line/60 border-t px-4 py-3">
			<label className="flex flex-wrap items-center justify-between gap-2">
				<span className="flex flex-col">
					<span className="text-sm font-medium">Přelom pololetí</span>
					<span className="text-ink-faint text-xs">
						Podle tohohle data se dělí dluhy a platby. Prázdné pole pololetí vypne.
					</span>
				</span>
				<input
					type="date"
					value={season.halfYearOn ?? ''}
					min={season.startsOn}
					max={season.endsOn}
					disabled={save.isPending}
					onChange={(event) => change(event.target.value)}
					className="border-line bg-surface-2 text-ink min-h-11 rounded-xl border px-3 py-2.5 text-base disabled:opacity-50"
				/>
			</label>
			{error === null ? null : (
				<p role="alert" className="text-debt mt-2 text-sm">
					{error}
				</p>
			)}
		</div>
	)
}

interface SeasonCardProps {
	season: Season
	isOpen: boolean
	onToggleOpen: (open: boolean) => void
	onView: () => void
	/** Uzavření sezóny a přelom pololetí jsou jen pro admina; soupisku mění i pínař. */
	isAdmin: boolean
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
	isAdmin,
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
					{closed || !isAdmin ? null : (
						<Button size="sm" variant="danger" loading={closing} onClick={() => setConfirmingClose(true)}>
							Uzavřít
						</Button>
					)}
				</div>
			</div>

			{closed || !isAdmin ? null : <HalfYearField season={season} />}

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
	if (roster.isPending || (!closed && members.isPending)) {
		return <LoadingState />
	}
	if (roster.error !== null) {
		return <ErrorState error={roster.error} onRetry={() => void roster.refetch()} />
	}
	if (!closed && members.error !== null) {
		return <ErrorState error={members.error} onRetry={() => void members.refetch()} />
	}

	const rosterEntries = roster.data ?? []

	if (closed) {
		return <RosterReadOnly roster={rosterEntries} />
	}

	return <RosterEditor members={members.data ?? []} roster={rosterEntries} onSave={onSave} />
}

function RosterReadOnly({ roster }: { roster: RosterEntry[] }) {
	if (roster.length === 0) {
		return <p className="text-ink-muted text-sm">Soupiska je prázdná.</p>
	}

	return (
		<div className="divide-line/50 divide-y">
			{roster.map((entry) => (
				<div key={entry.membershipId} className="flex items-center gap-3 py-2 text-sm">
					<Avatar name={entry.name} src={entry.avatarUrl} jerseyNumber={entry.jerseyNumber} size="sm" />
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
	// Výchozí výběr je aktuální soupiska; komponenta se remountuje při přepnutí sezóny (viz `key` níž),
	// takže se stav vždy srovná s čerstvými daty.
	const [selected, setSelected] = useState<Set<number>>(() => new Set(roster.map((entry) => entry.membershipId)))

	// Pořadí a kandidáti se zmrazí při otevření panelu, ať řádky při odškrtávání neposkakují —
	// kdo odešel, ale byl na soupisce, zůstává viditelný i po odškrtnutí.
	const [initialRoster] = useState(() => new Set(roster.map((entry) => entry.membershipId)))

	const candidates = members
		.filter((member) => member.status !== 'left' || initialRoster.has(member.id))
		.toSorted((a, b) => {
			const byRoster = Number(initialRoster.has(b.id)) - Number(initialRoster.has(a.id))

			return byRoster === 0 ? a.name.localeCompare(b.name, 'cs') : byRoster
		})

	const [status, setStatus] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle')

	// Každé kliknutí ukládá rovnou celou soupisku; požadavky jdou ve frontě, ať rychlé klikání
	// nedoručí starší stav jako poslední.
	const queue = useRef<Promise<unknown>>(Promise.resolve())
	/** Poslední potvrzený stav; při chybě se výběr vrátí k němu. */
	const confirmed = useRef<Set<number>>(new Set(roster.map((entry) => entry.membershipId)))
	/** Zrcadlo výběru pro případ dvou kliknutí dřív, než se komponenta překreslí. */
	const latest = useRef<Set<number>>(selected)

	function toggle(id: number) {
		const next = new Set(latest.current)
		if (next.has(id)) {
			next.delete(id)
		} else {
			next.add(id)
		}

		latest.current = next
		setSelected(next)
		setStatus('saving')

		const snapshot = [...next]

		queue.current = queue.current
			.then(async () => {
				await onSave(snapshot)
				confirmed.current = new Set(snapshot)
				setStatus('saved')
			})
			.catch(() => {
				// Neuložilo se — výběr se vrátí tam, kde ho server naposledy potvrdil,
				// ať obrazovka neukazuje soupisku, která nikde není.
				latest.current = new Set(confirmed.current)
				setSelected(new Set(confirmed.current))
				setStatus('error')
			})
	}

	return (
		<div className="flex flex-col gap-3">
			<p className="text-ink-muted text-sm">
				{players(selected.size)} na soupisce
				{status === 'saving' ? <span className="text-ink-faint ml-2">· ukládá se…</span> : null}
				{status === 'saved' ? <span className="text-bonus ml-2">· uloženo</span> : null}
				{status === 'error' ? <span className="text-debt ml-2">· uložení selhalo, zkuste to znovu</span> : null}
			</p>

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
