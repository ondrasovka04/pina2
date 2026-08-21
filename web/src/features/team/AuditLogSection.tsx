import { Button } from '@/components/ui/Button'
import { Card } from '@/components/ui/Card'
import { EmptyState, ErrorState, LoadingState } from '@/components/ui/States'
import { describeAuditEntry } from '@/features/team/audit'
import { useAuditLog } from '@/lib/queries'
import { formatDateTime } from '@/lib/types'

export function AuditLogSection({ teamId }: { teamId: number }) {
	const audit = useAuditLog(teamId, true)
	const items = audit.data?.pages.flatMap((page) => page.items) ?? []

	return (
		<Card className="overflow-hidden">
			<div className="px-4 py-3">
				<h2 className="font-semibold">Provozní stopa</h2>
				<p className="text-ink-faint text-sm">Citlivé změny peněz, oprávnění a nastavení.</p>
			</div>

			{audit.isPending ? <LoadingState label="Načítá se provozní stopa…" /> : null}
			{audit.error === null ? null : <ErrorState error={audit.error} onRetry={() => void audit.refetch()} />}
			{!audit.isPending && audit.error === null && items.length === 0 ? (
				<EmptyState title="Zatím bez záznamů" description="Citlivé změny družstva se objeví tady." />
			) : null}

			{items.length === 0 ? null : (
				<div className="divide-line/60 border-line divide-y border-t">
					{items.map((entry) => (
						<div key={entry.id} className="px-4 py-3">
							<p className="text-sm">{describeAuditEntry(entry)}</p>
							<p className="text-ink-faint mt-1 text-xs">
								{entry.actor?.name ?? 'Smazaný uživatel'} · {formatDateTime(entry.createdAt)}
							</p>
						</div>
					))}
				</div>
			)}

			{audit.hasNextPage ? (
				<div className="border-line border-t px-4 py-3 text-center">
					<Button variant="ghost" loading={audit.isFetchingNextPage} onClick={() => void audit.fetchNextPage()}>
						Načíst starší
					</Button>
				</div>
			) : null}
		</Card>
	)
}
