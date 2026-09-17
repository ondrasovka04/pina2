import { useMemo, useState } from 'react'
import { Link } from 'react-router'

import { useTeam } from '@/app/team'
import { NoSeasonState } from '@/components/NoSeasonState'
import { Avatar } from '@/components/ui/Avatar'
import { Card } from '@/components/ui/Card'
import { ChevronRightIcon } from '@/components/ui/icons'
import { Money } from '@/components/ui/Money'
import { EmptyState, ErrorState, LoadingState } from '@/components/ui/States'
import { PaymentQrCard } from '@/features/balances/PaymentQrCard'
import { memberBalance, memberRecordCount, sumsFor, teamSums } from '@/features/balances/period'
import { PeriodTabs } from '@/features/balances/PeriodTabs'
import { cn } from '@/lib/cn'
import { records } from '@/lib/plural'
import { useBalances } from '@/lib/queries'
import type { MemberBalance, PeriodKey } from '@/lib/types'
import { formatCzk } from '@/lib/types'

type Sort = 'debt' | 'name'

export function BalancesPage() {
	const { team, seasonId } = useTeam()
	const { data, isPending, error, refetch } = useBalances(seasonId)
	const [sort, setSort] = useState<Sort>('debt')
	const [period, setPeriod] = useState<PeriodKey>('all')

	const myMembershipId = team?.membershipId ?? null
	const travelEnabled = team?.travelEnabled === true

	const members = useMemo(() => {
		const list = data?.members ?? []
		return sort === 'debt' ? list.toSorted((a, b) => memberBalance(b, period) - memberBalance(a, period)) : list
	}, [data, sort, period])

	const me = members.find((member) => member.membershipId === myMembershipId)

	// Pořadí v žebříčku — nevytahujeme si to na první místo, to by zbilo zábavu
	const myRank = useMemo(() => {
		if (me === undefined) {
			return null
		}
		const order = (data?.members ?? []).toSorted((a, b) => memberBalance(b, period) - memberBalance(a, period))

		return order.findIndex((member) => member.membershipId === me.membershipId) + 1
	}, [data, me, period])

	if (seasonId === null) {
		return <NoSeasonState />
	}

	if (isPending) {
		return <LoadingState />
	}
	if (error !== null) {
		return <ErrorState error={error} onRetry={() => void refetch()} />
	}

	const totals = teamSums(data, period)

	return (
		<div className="flex flex-col gap-4">
			<Card className="overflow-hidden">
				<div className="flex items-baseline justify-between gap-4 px-4 py-4">
					{myMembershipId === null ? null : (
						<div>
							<p className="text-ink-muted text-sm">Můj dluh</p>
							<p className="mt-1 text-3xl font-semibold">
								<Money czk={me === undefined ? 0 : memberBalance(me, period)} tone="balance" />
							</p>
							{myRank === null || data.visibility === 'own' ? null : (
								<p className="text-ink-faint mt-1 text-xs">
									{myRank}. z {members.length}
								</p>
							)}
						</div>
					)}
					<div className={myMembershipId === null ? undefined : 'text-right'}>
						<p className="text-ink-muted text-sm">Zbývá vyrovnat</p>
						<p className="tabular mt-1 text-lg font-medium">{formatCzk(totals.balanceCzk)}</p>
						<p className="text-ink-faint mt-1 text-xs">Zaplaceno {formatCzk(totals.paidCzk)}</p>
					</div>
				</div>
				<PeriodTabs periods={data.periods} active={period} onChange={setPeriod} />
			</Card>

			{/* QR je vždycky na celý nedoplatek sezóny, přepínač na něj nesahá. */}
			{myMembershipId === null ? null : <PaymentQrCard seasonId={seasonId} membershipId={myMembershipId} />}

			<div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
				<div className="flex items-baseline gap-3">
					<h1 className="text-lg font-semibold">{data.visibility === 'own' ? 'Moje konto' : 'Kdo kolik dluží'}</h1>
					{/* Odsud se stornuje omylem odeslaný trénink celý, ne po lidech. */}
					<Link to="/zapisy" className="text-ink-muted text-sm">
						Zápisy
					</Link>
					{/* „a cesťáky" jen tam, kde nějaké jsou — stejné pravidlo jako záložka na `/platby`. */}
					<Link to="/platby" className="text-ink-muted text-sm">
						{travelEnabled || data.travelCzk !== 0 ? 'Platby a cesťáky' : 'Platby'}
					</Link>
				</div>
				{data.visibility === 'own' ? null : (
					<div className="bg-surface-2 flex self-stretch rounded-lg p-0.5 text-sm sm:self-auto">
						<SortTab active={sort === 'debt'} onClick={() => setSort('debt')}>
							Podle dluhu
						</SortTab>
						<SortTab active={sort === 'name'} onClick={() => setSort('name')}>
							Podle jména
						</SortTab>
					</div>
				)}
			</div>

			{members.length === 0 ? (
				<EmptyState title="Zatím nikdo nic nedluží" description="Sezóna je čistá — nebo se ještě nezapisovalo." />
			) : (
				<Card className="divide-line/50 divide-y">
					{members.map((member) => (
						<MemberRow
							key={member.membershipId}
							member={member}
							period={period}
							isMe={member.membershipId === myMembershipId}
						/>
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
			className={cn(
				'min-h-9 flex-1 rounded-md px-3 transition-colors sm:flex-none',
				active ? 'bg-brand-600 text-white' : 'text-ink-muted',
			)}
		>
			{children}
		</button>
	)
}

function MemberRow({ member, period, isMe }: { member: MemberBalance; period: PeriodKey; isMe: boolean }) {
	const sums = sumsFor(member, period)
	const paid = sums?.paidCzk ?? member.paidCzk
	const travel = sums?.travelCzk ?? member.travelCzk

	return (
		<Link
			to={`/hraci/${member.membershipId}`}
			className={cn(
				'flex items-center gap-3 px-4 py-3 transition-colors first:rounded-t-2xl last:rounded-b-2xl hover:bg-surface-2',
				isMe && 'bg-brand-600/10',
			)}
		>
			<Avatar name={member.name} src={member.avatarUrl} jerseyNumber={member.jerseyNumber} />

			<div className="min-w-0 flex-1">
				<p className="truncate font-medium">
					{member.name}
					{isMe ? <span className="text-accent ml-2 text-xs font-normal">já</span> : null}
				</p>
				<p className="text-ink-faint text-xs">
					{records(memberRecordCount(member, period))} · zaplaceno {formatCzk(paid)}
					{travel === 0 ? null : ` · cesťáky ${formatCzk(travel)}`}
					{/* Není na soupisce, ale dluh po sobě nechal — odchod z týmu ho nemaže. */}
					{member.onRoster ? null : ' · mimo soupisku'}
				</p>
			</div>

			<Money czk={memberBalance(member, period)} tone="balance" className="font-semibold" />
			<ChevronRightIcon className="text-ink-faint size-4" />
		</Link>
	)
}
