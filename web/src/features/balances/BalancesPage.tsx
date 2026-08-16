import { useMemo, useState } from 'react'
import { Link } from 'react-router'

import { useTeam } from '@/app/team'
import { NoSeasonState } from '@/components/NoSeasonState'
import { Avatar } from '@/components/ui/Avatar'
import { Card } from '@/components/ui/Card'
import { ChevronRightIcon } from '@/components/ui/icons'
import { Money } from '@/components/ui/Money'
import { EmptyState, ErrorState, LoadingState } from '@/components/ui/States'
import { cn } from '@/lib/cn'
import { records } from '@/lib/plural'
import { useBalances } from '@/lib/queries'
import type { MemberBalance } from '@/lib/types'
import { formatCzk } from '@/lib/types'

type Sort = 'debt' | 'name'

export function BalancesPage() {
	const { team, seasonId } = useTeam()
	const { data, isPending, error, refetch } = useBalances(seasonId)
	const [sort, setSort] = useState<Sort>('debt')

	const myMembershipId = team?.membershipId ?? null

	const members = useMemo(() => {
		const list = data?.members ?? []
		return sort === 'debt' ? list.toSorted((a, b) => b.balanceCzk - a.balanceCzk) : list
	}, [data, sort])

	const me = members.find((member) => member.membershipId === myMembershipId)

	// Pořadí v žebříčku — nevytahujeme si to na první místo, to by zbilo zábavu
	const myRank = useMemo(() => {
		if (me === undefined) return null
		const order = (data?.members ?? []).toSorted((a, b) => b.balanceCzk - a.balanceCzk)

		return order.findIndex((member) => member.membershipId === me.membershipId) + 1
	}, [data, me])

	if (seasonId === null) {
		return <NoSeasonState />
	}

	if (isPending) return <LoadingState />
	if (error !== null) return <ErrorState error={error} onRetry={() => void refetch()} />

	return (
		<div className="flex flex-col gap-4">
			<Card className="overflow-hidden">
				<div className="flex items-baseline justify-between gap-4 px-4 py-4">
					<div>
						<p className="text-ink-muted text-sm">Můj dluh</p>
						<p className="mt-1 text-3xl font-semibold">
							<Money czk={me?.balanceCzk ?? 0} tone="balance" />
						</p>
						{myRank === null ? null : (
							<p className="text-ink-faint mt-1 text-xs">
								{myRank}. z {members.length}
							</p>
						)}
					</div>
					<div className="text-right">
						<p className="text-ink-muted text-sm">V píně celkem</p>
						<p className="tabular mt-1 text-lg font-medium">{formatCzk(data.totalCzk)}</p>
					</div>
				</div>
			</Card>

			<div className="flex items-center justify-between">
				<div className="flex items-baseline gap-3">
					<h1 className="text-lg font-semibold">Kdo kolik dluží</h1>
					{/* Odsud se stornuje omylem odeslaný trénink celý, ne po lidech. */}
					<Link to="/zapisy" className="text-ink-muted text-sm">
						Zápisy
					</Link>
				</div>
				<div className="bg-surface-2 flex rounded-lg p-0.5 text-sm">
					<SortTab active={sort === 'debt'} onClick={() => setSort('debt')}>
						Podle dluhu
					</SortTab>
					<SortTab active={sort === 'name'} onClick={() => setSort('name')}>
						Podle jména
					</SortTab>
				</div>
			</div>

			{members.length === 0 ? (
				<EmptyState title="Zatím nikdo nic nedluží" description="Sezóna je čistá — nebo se ještě nezapisovalo." />
			) : (
				<Card className="divide-line/50 divide-y">
					{members.map((member) => (
						<MemberRow key={member.membershipId} member={member} isMe={member.membershipId === myMembershipId} />
					))}
				</Card>
			)}
		</div>
	)
}

function SortTab({ active, onClick, children }: { active: boolean; onClick: () => void; children: string }) {
	return (
		<button
			type="button"
			onClick={onClick}
			aria-pressed={active}
			className={cn('min-h-9 rounded-md px-3 transition-colors', active ? 'bg-brand-600 text-white' : 'text-ink-muted')}
		>
			{children}
		</button>
	)
}

function MemberRow({ member, isMe }: { member: MemberBalance; isMe: boolean }) {
	return (
		<Link
			to={`/hraci/${member.membershipId}`}
			className={cn(
				'flex items-center gap-3 px-4 py-3 transition-colors first:rounded-t-2xl last:rounded-b-2xl hover:bg-surface-2',
				isMe && 'bg-brand-600/10',
			)}
		>
			<Avatar name={member.name} jerseyNumber={member.jerseyNumber} />

			<div className="min-w-0 flex-1">
				<p className="truncate font-medium">
					{member.name}
					{isMe ? <span className="text-accent ml-2 text-xs font-normal">já</span> : null}
				</p>
				<p className="text-ink-faint text-xs">
					{records(member.recordCount)}
					{/* Není na soupisce, ale dluh po sobě nechal — odchod z týmu ho nemaže. */}
					{member.onRoster ? null : ' · mimo soupisku'}
				</p>
			</div>

			<Money czk={member.balanceCzk} tone="balance" className="font-semibold" />
			<ChevronRightIcon className="text-ink-faint size-4" />
		</Link>
	)
}
