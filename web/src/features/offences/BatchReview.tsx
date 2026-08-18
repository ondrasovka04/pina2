import { Link } from 'react-router'

import { Avatar } from '@/components/ui/Avatar'
import { Button } from '@/components/ui/Button'
import { Card } from '@/components/ui/Card'
import { ArrowLeftIcon, CheckIcon } from '@/components/ui/icons'
import { Money } from '@/components/ui/Money'
import type { DraftSummary } from '@/features/offences/draft'
import { players, records } from '@/lib/plural'
import type { BatchSummary, PriceChange } from '@/lib/types'
import { formatCzk, formatDate } from '@/lib/types'

interface BatchReviewProps {
	summary: DraftSummary
	occurredOn: string
	title: string | null
	priceChanges: PriceChange[] | null
	submitting: boolean
	error: string | null
	onBack: () => void
	onConfirm: () => void
}

// Poslední krok: přečti si rozpis a dluh před potvrzením
export function BatchReview({
	summary,
	occurredOn,
	title,
	priceChanges,
	submitting,
	error,
	onBack,
	onConfirm,
}: BatchReviewProps) {
	return (
		<div className="flex flex-col gap-4">
			<div className="flex items-center gap-2">
				<button
					type="button"
					onClick={onBack}
					className="text-ink-muted -ml-2 inline-flex items-center gap-1 rounded-lg px-2 text-sm"
				>
					<ArrowLeftIcon className="size-5" />
					Upravit
				</button>
			</div>

			<div>
				<h1 className="text-lg font-semibold">{title ?? 'Zápis prohřešků'}</h1>
				<p className="text-ink-muted text-sm">
					{formatDate(occurredOn)} · {records(summary.recordCount)} · {players(summary.members.length)}
				</p>
			</div>

			{priceChanges === null ? null : (
				<Card className="border-accent/50 bg-accent/10 p-4">
					<p className="text-accent text-sm font-medium">Sazebník se mezitím změnil</p>
					<ul className="text-ink-muted mt-2 flex flex-col gap-1 text-sm">
						{priceChanges.map((change) => (
							<li key={change.offenceTypeId}>
								{change.name}: {formatCzk(change.expectedCzk)} → {formatCzk(change.currentCzk)}
							</li>
						))}
					</ul>
					<p className="text-ink-muted mt-2 text-sm">
						Částky v souhrnu jsou přepočítané na nové ceny. Zkontrolujte je a odešlete znovu.
					</p>
				</Card>
			)}

			<Card className="divide-line/50 divide-y">
				{summary.members.map((member) => (
					<div key={member.membershipId} className="px-4 py-3">
						<div className="flex items-center gap-3">
							<Avatar name={member.name} src={member.avatarUrl} jerseyNumber={member.jerseyNumber} size="sm" />
							<p className="min-w-0 flex-1 truncate font-medium">{member.name}</p>
							<Money czk={member.totalCzk} className="font-semibold" />
						</div>

						<ul className="text-ink-muted mt-2 ml-11 flex flex-col gap-1 text-sm">
							{member.items.map((item) => (
								<li key={item.offenceTypeId} className="flex items-baseline justify-between gap-3">
									<span className="truncate">
										{item.name}
										{item.count > 1 ? <span className="text-ink-faint"> ×{item.count}</span> : null}
									</span>
									<Money czk={item.totalCzk} className="text-sm" />
								</li>
							))}
						</ul>

						<p className="text-ink-faint mt-2 ml-11 text-xs">
							Dluh po zápisu: <Money czk={member.balanceCzk + member.totalCzk} tone="balance" className="text-xs" />
						</p>
					</div>
				))}
			</Card>

			{error === null ? null : (
				<p role="alert" className="bg-debt-500/15 text-debt rounded-xl px-3 py-2 text-sm">
					{error}
				</p>
			)}

			<div className="sticky bottom-24 z-10 md:bottom-4">
				<Card className="border-line bg-surface-2/95 flex items-center gap-3 p-3 backdrop-blur">
					<div className="min-w-0 flex-1">
						<p className="text-ink-faint text-xs">Celkem do píny</p>
						<p className="text-lg font-semibold">
							<Money czk={summary.totalCzk} />
						</p>
					</div>
					<Button variant="accent" size="lg" onClick={onConfirm} loading={submitting}>
						Zapsat
					</Button>
				</Card>
			</div>
		</div>
	)
}

interface BatchResultProps {
	result: BatchSummary
	onAnother: () => void
}

export function BatchResult({ result, onAnother }: BatchResultProps) {
	return (
		<div className="flex flex-col gap-4">
			<Card className="flex flex-col items-center gap-3 px-6 py-8 text-center">
				<span className="bg-bonus-500/20 text-bonus grid size-14 place-items-center rounded-full">
					<CheckIcon className="size-7" />
				</span>
				<div>
					<h1 className="text-lg font-semibold">Zapsáno</h1>
					<p className="text-ink-muted mt-1 text-sm">
						{records(result.recordCount)} · {players(result.memberCount)} · {formatDate(result.batch.occurredOn)}
					</p>
				</div>
				<p className="text-2xl font-semibold">
					<Money czk={result.totalCzk} />
				</p>
			</Card>

			<Card className="divide-line/50 divide-y">
				{result.members.map((member) => (
					<div key={member.membershipId} className="flex items-center gap-3 px-4 py-3">
						<Avatar name={member.name} src={member.avatarUrl} size="sm" />
						<div className="min-w-0 flex-1">
							<p className="truncate font-medium">{member.name}</p>
							<p className="text-ink-faint text-xs">
								nově dluží <Money czk={member.balanceCzk} tone="balance" className="text-xs" />
							</p>
						</div>
						<Money czk={member.totalCzk} className="font-medium" />
					</div>
				))}
			</Card>

			<div className="flex gap-3">
				<Button variant="accent" size="lg" fullWidth onClick={onAnother}>
					Zapsat další
				</Button>
				{/* Šířka podle nápisu, ne půl obrazovky — s `flex-1` se text zalomil na dva řádky. */}
				<Link
					to="/dluhy"
					role="button"
					className="bg-surface-2 text-ink inline-flex min-h-12 shrink-0 items-center justify-center rounded-xl px-5 text-base whitespace-nowrap"
				>
					Na dluhy
				</Link>
			</div>
		</div>
	)
}
