import { useState } from 'react'
import { Link, Navigate, useParams } from 'react-router'

import { useTeam } from '@/app/team'
import { NoSeasonState } from '@/components/NoSeasonState'
import { Avatar } from '@/components/ui/Avatar'
import { Card } from '@/components/ui/Card'
import { ConfirmDialog } from '@/components/ui/ConfirmDialog'
import { ArrowLeftIcon, XIcon } from '@/components/ui/icons'
import { Money } from '@/components/ui/Money'
import { EmptyState, ErrorState, LoadingState } from '@/components/ui/States'
import { cn } from '@/lib/cn'
import { records as recordsLabel } from '@/lib/plural'
import { useBalances, useRecords, useVoidRecord } from '@/lib/queries'
import type { OffenceRecord } from '@/lib/types'
import { formatDate } from '@/lib/types'

export function MemberPage() {
	const params = useParams()
	const membershipId = Number(params.membershipId)
	const validId = Number.isInteger(membershipId) && membershipId > 0

	const { seasonId, can } = useTeam()
	const balances = useBalances(seasonId)
	const records = useRecords(validId ? seasonId : null, validId ? membershipId : undefined)
	const voidRecord = useVoidRecord(seasonId ?? 0)
	const [voidingRecordId, setVoidingRecordId] = useState<number | null>(null)

	if (!validId) return <Navigate to="/dluhy" replace />

	if (seasonId === null) {
		return <NoSeasonState />
	}

	if (balances.isPending || records.isPending) return <LoadingState />
	if (balances.error !== null) return <ErrorState error={balances.error} onRetry={() => void balances.refetch()} />
	if (records.error !== null) return <ErrorState error={records.error} onRetry={() => void records.refetch()} />

	const member = balances.data.members.find((item) => item.membershipId === membershipId)

	if (member === undefined) return <Navigate to="/dluhy" replace />

	const canVoid = can('treasurer')
	const groups = groupByDate(records.data.items)

	return (
		<div className="flex flex-col gap-4">
			<ConfirmDialog
				open={voidingRecordId !== null}
				title="Stornovat zápis?"
				description="Zápis se nesmaže, jen se zruší — v historii zůstane dohledatelný."
				confirmLabel="Stornovat"
				danger
				onConfirm={() => {
					if (voidingRecordId !== null) voidRecord.mutate(voidingRecordId)
					setVoidingRecordId(null)
				}}
				onCancel={() => setVoidingRecordId(null)}
			/>

			<Link to="/dluhy" className="text-ink-muted hover:text-ink inline-flex items-center gap-1.5 text-sm">
				<ArrowLeftIcon className="size-4" />
				Zpět na dluhy
			</Link>

			<Card className="overflow-hidden">
				<div className="flex items-center gap-4 px-4 py-4">
					<Avatar name={member.name} jerseyNumber={member.jerseyNumber} />
					<div className="min-w-0 flex-1">
						<p className="truncate text-lg font-semibold">{member.name}</p>
						<p className="text-ink-muted text-sm">{recordsLabel(member.recordCount)}</p>
					</div>
					<p className="text-3xl font-semibold">
						<Money czk={member.balanceCzk} tone="balance" />
					</p>
				</div>
			</Card>

			{groups.length === 0 ? (
				<EmptyState title="Zatím žádný zápis" description="Hráč zatím nemá žádný prohřešek ani bonus." />
			) : (
				<div className="flex flex-col gap-4">
					{groups.map(([date, items]) => (
						<div key={date}>
							<p className="text-ink-muted mb-2 text-sm font-medium">{formatDate(date)}</p>
							<Card className="divide-line/50 divide-y">
								{items.map((record) => (
									<RecordRow
										key={record.id}
										record={record}
										canVoid={canVoid}
										voiding={voidRecord.isPending}
										onVoid={() => setVoidingRecordId(record.id)}
									/>
								))}
							</Card>
						</div>
					))}
				</div>
			)}
		</div>
	)
}

interface RecordRowProps {
	record: OffenceRecord
	canVoid: boolean
	voiding: boolean
	onVoid: () => void
}

function RecordRow({ record, canVoid, voiding, onVoid }: RecordRowProps) {
	const voided = record.voidedAt !== null

	return (
		<div
			className={cn('flex items-center gap-3 px-4 py-3 first:rounded-t-2xl last:rounded-b-2xl', voided && 'opacity-50')}
		>
			<div className="min-w-0 flex-1">
				<p className={cn('font-medium', voided && 'line-through')}>{record.offenceTypeName}</p>
				{record.note === null ? null : (
					<p className={cn('truncate text-xs text-ink-faint', voided && 'line-through')}>{record.note}</p>
				)}
			</div>

			<Money czk={record.amountCzk} className={cn(voided && 'line-through')} />

			{canVoid && !voided ? (
				<button
					type="button"
					onClick={onVoid}
					disabled={voiding}
					aria-label="Stornovat zápis"
					className="text-ink-faint hover:bg-surface-2 hover:text-debt inline-flex size-9 shrink-0 items-center justify-center rounded-lg transition-colors disabled:cursor-not-allowed disabled:opacity-50"
				>
					<XIcon className="size-4" />
				</button>
			) : null}
		</div>
	)
}

/** Zápisy seskupené podle data prohřešku, od nejnovějšího. */
function groupByDate(items: OffenceRecord[]): Array<[string, OffenceRecord[]]> {
	const groups = new Map<string, OffenceRecord[]>()

	for (const item of items) {
		const existing = groups.get(item.occurredOn)
		if (existing === undefined) {
			groups.set(item.occurredOn, [item])
		} else {
			existing.push(item)
		}
	}

	return [...groups.entries()].toSorted(([a], [b]) => (a < b ? 1 : a > b ? -1 : 0))
}
