import { useState } from 'react'

import { useTeam } from '@/app/team'
import { Button } from '@/components/ui/Button'
import { Card, CardHeader } from '@/components/ui/Card'
import { ConfirmDialog } from '@/components/ui/ConfirmDialog'
import { CalendarFeedDialog } from '@/features/events/CalendarFeedDialog'
import { useCalendarFeeds, useIssueCalendarFeed, useRevokeCalendarFeed } from '@/lib/queries'
import type { CalendarFeed, IssuedCalendarFeed } from '@/lib/types'
import { formatDateTime } from '@/lib/types'

interface FeedRow {
	key: string
	teamName: string
	seasonId: number
	seasonName: string
	feed: CalendarFeed | null
}

export function CalendarFeedsCard() {
	const { teams } = useTeam()
	const feeds = useCalendarFeeds()
	/**
	 * Vydaná adresa patří kartě, ne řádku. Po založení odběru se řádek překlíčuje
	 * ze „sezóna bez odběru" na „odběr", takže ho React odmontuje — a kdyby dialog
	 * s tajnou adresou visel v něm, zmizel by zároveň s ním. Adresa se přitom
	 * ukazuje jen jednou a znovu ji ze serveru získat nejde.
	 */
	const [issued, setIssued] = useState<IssuedCalendarFeed | null>(null)

	const active = feeds.data ?? []
	const activeSeasons = new Set(active.map((feed) => feed.seasonId))
	const rows: FeedRow[] = [
		...active.map((feed) => ({
			key: `feed-${feed.id}`,
			teamName: feed.teamName,
			seasonId: feed.seasonId,
			seasonName: feed.seasonName,
			feed,
		})),
		...teams.flatMap((team) => {
			const season = team.currentSeason
			if (season === null || activeSeasons.has(season.id)) return []

			return [
				{
					key: `season-${season.id}`,
					teamName: team.name,
					seasonId: season.id,
					seasonName: season.name,
					feed: null,
				},
			]
		}),
	]

	return (
		<Card id="odbery-kalendare" className="scroll-mt-4">
			<CardHeader title="Odběr kalendáře" subtitle="Termíny se v telefonu aktualizují automaticky." />

			{feeds.isPending ? <p className="text-ink-faint px-4 pb-4 text-sm">Načítám odběry…</p> : null}
			{feeds.error === null ? null : (
				<p role="alert" className="text-debt px-4 pb-4 text-sm">
					{feeds.error.message}
				</p>
			)}

			{!feeds.isPending && feeds.error === null && rows.length === 0 ? (
				<p className="text-ink-faint px-4 pb-4 text-sm">Pro odběr zatím není dostupná žádná sezóna.</p>
			) : null}

			<div className="divide-line/50 divide-y">
				{rows.map((row) => (
					<CalendarFeedRow key={row.key} row={row} onIssued={setIssued} />
				))}
			</div>

			<CalendarFeedDialog feed={issued} onClose={() => setIssued(null)} />
		</Card>
	)
}

interface CalendarFeedRowProps {
	row: FeedRow
	onIssued: (feed: IssuedCalendarFeed) => void
}

function CalendarFeedRow({ row, onIssued }: CalendarFeedRowProps) {
	const issue = useIssueCalendarFeed()
	const revoke = useRevokeCalendarFeed()
	const [confirming, setConfirming] = useState(false)

	async function create() {
		try {
			onIssued(await issue.mutateAsync(row.seasonId))
		} catch {
			// Hlaška ze serveru zůstává pod řádkem.
		}
	}

	async function remove() {
		if (row.feed === null) return

		try {
			await revoke.mutateAsync(row.feed.id)
			setConfirming(false)
		} catch {
			setConfirming(false)
		}
	}

	const error = issue.error ?? revoke.error

	return (
		<div className="px-4 py-3">
			<div className="flex items-center justify-between gap-3">
				<div className="min-w-0">
					<p className="truncate font-medium">{row.teamName}</p>
					<p className="text-ink-faint text-xs">{row.seasonName}</p>
					{row.feed === null ? (
						<p className="text-ink-muted mt-1 text-xs">Odběr není aktivní.</p>
					) : (
						<p className="text-ink-muted mt-1 text-xs">
							Aktivní od {formatDateTime(row.feed.createdAt)}
							{row.feed.lastUsedAt === null
								? ' · zatím nenačtený'
								: ` · načtený ${formatDateTime(row.feed.lastUsedAt)}`}
						</p>
					)}
				</div>

				{row.feed === null ? (
					<Button size="sm" loading={issue.isPending} onClick={() => void create()}>
						Vytvořit odběr
					</Button>
				) : (
					<Button size="sm" variant="ghost" onClick={() => setConfirming(true)}>
						Zneplatnit
					</Button>
				)}
			</div>

			{error === null ? null : (
				<p role="alert" className="text-debt mt-2 text-sm">
					{error.message}
				</p>
			)}

			<ConfirmDialog
				open={confirming}
				title="Zneplatnit odběr kalendáře?"
				description="Telefon přestane dostávat změny termínů. Později můžete vydat novou adresu."
				confirmLabel="Zneplatnit"
				danger
				onConfirm={() => void remove()}
				onCancel={() => setConfirming(false)}
			/>
		</div>
	)
}
