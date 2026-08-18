import { useSyncExternalStore } from 'react'

import { Button } from '@/components/ui/Button'
import { Card, CardHeader } from '@/components/ui/Card'
import { clearInstallPrompt, getInstallPrompt, subscribeToInstallPrompt } from '@/lib/pwa-install'

export function AppInstallCard() {
	const prompt = useSyncExternalStore(subscribeToInstallPrompt, getInstallPrompt, () => null)
	const standalone = window.matchMedia('(display-mode: standalone)').matches
	const ios = /iPad|iPhone|iPod/.test(navigator.userAgent)

	if (standalone) {
		return (
			<Card>
				<CardHeader title="Aplikace v telefonu" />
				<p className="text-ink-muted px-4 py-3 text-sm">Pína je nainstalovaná na ploše.</p>
			</Card>
		)
	}

	if (prompt === null && !ios) return null

	async function install() {
		if (prompt === null) return
		await prompt.prompt()
		await prompt.userChoice
		clearInstallPrompt()
	}

	return (
		<Card>
			<CardHeader title="Aplikace v telefonu" />
			<div className="flex items-center justify-between gap-3 p-4">
				<p className="text-ink-muted text-sm">
					{ios ? 'V Safari zvolte Sdílet a Přidat na plochu.' : 'Přidejte si Pínu na plochu telefonu.'}
				</p>
				{prompt === null ? null : (
					<Button size="sm" onClick={() => void install()}>
						Nainstalovat
					</Button>
				)}
			</div>
		</Card>
	)
}
