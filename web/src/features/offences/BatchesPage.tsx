import { useState } from 'react'
import { Link } from 'react-router'

import { useTeam } from '@/app/team'
import { NoSeasonState } from '@/components/NoSeasonState'
import { Card } from '@/components/ui/Card'
import { ConfirmDialog } from '@/components/ui/ConfirmDialog'
import { ArrowLeftIcon } from '@/components/ui/icons'
import { Money } from '@/components/ui/Money'
import { EmptyState, ErrorState, LoadingState } from '@/components/ui/States'
import { ApiError } from '@/lib/api'
import { cn } from '@/lib/cn'
import { players, records } from '@/lib/plural'
import type { BatchListItem } from '@/lib/queries'
import { useBatches, useVoidBatch } from '@/lib/queries'
import { formatDate } from '@/lib/types'

/** Dávky po měsících podle data konání — pořadí ze serveru (od nejnovější) se zachovává. */
interface BatchMonth {
	key: string
	label: string
	batches: BatchListItem[]
}

function groupByMonth(batches: BatchListItem[]): BatchMonth[] {
	const months: BatchMonth[] = []

	for (const batch of batches) {
		const key = batch.occurredOn.slice(0, 7)
		const last = months.at(-1)

		if (last?.key === key) {
			last.batches.push(batch)

			continue
		}

		months.push({ key, label: monthLabel(batch.occurredOn), batches: [batch] })
	}

	return months
}

function monthLabel(occurredOn: string): string {
	const date = new Date(`${occurredOn.slice(0, 10)}T00:00:00`)

	if (Number.isNaN(date.getTime())) return occurredOn.slice(0, 7)

	return new Intl.DateTimeFormat('cs-CZ', { month: 'long', year: 'numeric' }).format(date)
}

export function BatchesPage() {
	const { seasonId, season, isSeasonClosed, can } = useTeam()
	const batches = useBatches(seasonId)
	const voidBatch = useVoidBatch(seasonId ?? 0)

	const [voidingBatchId, setVoidingBatchId] = useState<number | null>(null)
	const [voidError, setVoidError] = useState<string | null>(null)

	if (seasonId === null) {
		return <NoSeasonState what="zápisy" />
	}

	if (batches.isPending) return <LoadingState />
	if (batches.error !== null) return <ErrorState error={batches.error} onRetry={() => void batches.refetch()} />

	const canVoid = can('treasurer') && !isSeasonClosed
	const months = groupByMonth(batches.data)

	async function confirmVoid() {
		if (voidingBatchId === null) return

		setVoidError(null)

		try {
			await voidBatch.mutateAsync(voidingBatchId)
			setVoidingBatchId(null)
		} catch (cause) {
			setVoidError(cause instanceof ApiError ? cause.message : 'Storno se nepodařilo. Zkontrolujte připojení.')
		}
	}

	return (
		<div className="flex flex-col gap-4">
			<ConfirmDialog
				open={voidingBatchId !== null}
				title="Stornovat celou dávku?"
				description="Zápisy se nesmažou, jen se označí jako stornované a přestanou se počítat do dluhu. Je to vidět v historii hráče a jde to udělat jen jednou."
				confirmLabel="Stornovat"
				danger
				onConfirm={() => void confirmVoid()}
				onCancel={() => {
					setVoidingBatchId(null)
					setVoidError(null)
				}}
			/>

			<Link to="/dluhy" className="text-ink-muted hover:text-ink inline-flex items-center gap-1.5 text-sm">
				<ArrowLeftIcon className="size-4" />
				Zpět na dluhy
			</Link>

			<div>
				<h1 className="text-lg font-semibold">Zápisy</h1>
				<p className="text-ink-muted text-sm">
					{season?.name ?? ''} · Přehled dávek, kterými se do píny zapsaly prohřešky a bonusy.
				</p>
			</div>

			{voidError === null ? null : <p className="text-debt text-sm">{voidError}</p>}

			{months.length === 0 ? (
				<EmptyState title="Zatím žádný zápis" description="Jakmile pínař zapíše první dávku, objeví se tady." />
			) : (
				<div className="flex flex-col gap-4">
					{months.map((month) => (
						<div key={month.key}>
							<p className="text-ink-muted mb-2 text-sm font-medium capitalize">{month.label}</p>
							<Card className="divide-line/50 divide-y">
								{month.batches.map((batch) => (
									<BatchRow
										key={batch.id}
										batch={batch}
										canVoid={canVoid}
										voiding={voidBatch.isPending && voidingBatchId === batch.id}
										onVoid={() => {
											setVoidError(null)
											setVoidingBatchId(batch.id)
										}}
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

interface BatchRowProps {
	batch: BatchListItem
	canVoid: boolean
	voiding: boolean
	onVoid: () => void
}

function BatchRow({ batch, canVoid, voiding, onVoid }: BatchRowProps) {
	const voided = batch.voidedAt !== null

	return (
		<div
			className={cn('flex items-center gap-3 px-4 py-3 first:rounded-t-2xl last:rounded-b-2xl', voided && 'opacity-50')}
		>
			<div className="min-w-0 flex-1">
				<div className="flex flex-wrap items-center gap-x-2">
					<p className={cn('font-medium', voided && 'line-through')}>{batch.title ?? 'Zápis'}</p>
					{voided ? (
						<span className="bg-surface-3 text-ink-muted rounded-md px-1.5 py-0.5 text-xs font-medium">Stornováno</span>
					) : null}
				</div>
				<p className="text-ink-faint truncate text-xs">
					{formatDate(batch.occurredOn)}
					{batch.eventTitle === null ? null : (
						<>
							{' · '}
							{batch.eventId === null ? (
								batch.eventTitle
							) : (
								<Link to={`/akce/${batch.eventId}`} className="hover:text-ink underline underline-offset-2">
									{batch.eventTitle}
								</Link>
							)}
						</>
					)}
					{batch.createdBy === null ? null : ` · zapsal ${batch.createdBy.name}`}
				</p>
				<p className="text-ink-faint text-xs">
					{records(batch.recordCount)} · {players(batch.memberCount)}
				</p>
			</div>

			<Money czk={batch.totalCzk} className={cn('font-semibold', voided && 'line-through')} />

			{canVoid && !voided ? (
				<button
					type="button"
					onClick={onVoid}
					disabled={voiding}
					className="text-ink-faint hover:bg-surface-2 hover:text-debt border-line inline-flex min-h-11 shrink-0 items-center rounded-lg border px-3 text-sm font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50"
				>
					Stornovat
				</button>
			) : null}
		</div>
	)
}
