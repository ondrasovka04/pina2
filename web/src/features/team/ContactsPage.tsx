import { useEffect, useState } from 'react'
import { Link } from 'react-router'

import { useTeam } from '@/app/team'
import { Avatar } from '@/components/ui/Avatar'
import { Button } from '@/components/ui/Button'
import { Card } from '@/components/ui/Card'
import { EmptyState, ErrorState, LoadingState } from '@/components/ui/States'
import { formatPhone } from '@/lib/phone'
import { useTeamContacts } from '@/lib/queries'
import type { TeamContact } from '@/lib/types'

/**
 * Telefony spoluhráčů, hlavně kvůli odvozům. Číslo samo volá (`tel:`),
 * kopírování je pro chat — tým si píše spíš přes WhatsApp než přes SMS.
 */
export function ContactsPage() {
	const { team } = useTeam()
	const contacts = useTeamContacts(team?.id ?? null)
	const [copiedId, setCopiedId] = useState<number | null>(null)

	useEffect(() => {
		if (copiedId === null) {
			return
		}
		const timeout = window.setTimeout(() => setCopiedId(null), 2000)
		return () => window.clearTimeout(timeout)
	}, [copiedId])

	async function copy(contact: TeamContact) {
		if (contact.phone === null) {
			return
		}
		try {
			await navigator.clipboard.writeText(contact.phone)
			setCopiedId(contact.membershipId)
		} catch {
			// Bez HTTPS nebo bez svolení schránka nefunguje; číslo je vypsané a dá se označit.
			setCopiedId(null)
		}
	}

	if (contacts.isPending) {
		return <LoadingState />
	}
	if (contacts.isError) {
		return <ErrorState error={contacts.error} onRetry={() => void contacts.refetch()} />
	}

	return (
		<div className="flex flex-col gap-4">
			<div>
				<h1 className="text-lg font-semibold">Kontakty</h1>
				<p className="text-ink-muted mt-1 text-sm">
					Čísla spoluhráčů z družstva {team?.name}. Své číslo si každý vyplní v{' '}
					<Link to="/ja" className="text-brand-600 underline-offset-2 hover:underline">
						profilu
					</Link>
					.
				</p>
			</div>

			{contacts.data.length === 0 ? (
				<EmptyState title="Zatím nikdo" description="V družstvu nejsou žádní aktivní členové." />
			) : (
				<Card className="divide-line/50 divide-y">
					{contacts.data.map((contact) => (
						<div key={contact.membershipId} className="flex items-center gap-3 px-4 py-2">
							<Avatar name={contact.name} src={contact.avatarUrl} jerseyNumber={contact.jerseyNumber} preview />
							<div className="min-w-0 flex-1">
								<p className="truncate text-sm font-medium">{contact.name}</p>
								{contact.phone === null ? (
									<p className="text-ink-faint text-sm">bez čísla</p>
								) : (
									<a
										href={`tel:${contact.phone}`}
										className="text-ink-muted text-sm tabular-nums underline underline-offset-2"
									>
										{formatPhone(contact.phone)}
									</a>
								)}
							</div>
							{contact.phone === null ? null : (
								<Button
									size="sm"
									variant="ghost"
									aria-label={`Kopírovat číslo: ${contact.name}`}
									onClick={() => void copy(contact)}
								>
									{copiedId === contact.membershipId ? 'Zkopírováno' : 'Kopírovat'}
								</Button>
							)}
						</div>
					))}
				</Card>
			)}
		</div>
	)
}
