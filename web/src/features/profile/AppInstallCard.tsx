import { useSyncExternalStore } from 'react'

import { Button } from '@/components/ui/Button'
import { Card, CardHeader } from '@/components/ui/Card'
import { clearInstallPrompt, getInstallPrompt, subscribeToInstallPrompt } from '@/lib/pwa-install'

/**
 * Dotyk, ne user agent: iPadOS se v Safari hlásí jako macOS, takže podle textu UA
 * bychom kartu schovali právě tam, kde je instalace k oznámením povinná.
 * `any-pointer` proto, že myš vedle dotyku (iPad s trackpadem) instalaci nevylučuje —
 * radši ji nabídnout i dotykovému notebooku než ji sebrat iPadu.
 */
function isHandheld(): boolean {
	return navigator.maxTouchPoints > 0 && window.matchMedia('(any-pointer: coarse)').matches
}

export function AppInstallCard() {
	const prompt = useSyncExternalStore(subscribeToInstallPrompt, getInstallPrompt, () => null)
	const standalone = window.matchMedia('(display-mode: standalone)').matches

	// Na počítači push funguje i bez instalace, karta by radila zbytečně.
	if (!isHandheld()) return null

	if (standalone) {
		return (
			<Card>
				<CardHeader title="Aplikace v telefonu" />
				<p className="text-ink-muted px-4 py-3 text-sm">Pína je nainstalovaná na ploše.</p>
			</Card>
		)
	}

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
				{/* Bez `beforeinstallprompt` se instaluje ručně — Safari to tlačítko
				    nemá vůbec, takže tam zbývá jen návod. */}
				<p className="text-ink-muted text-sm">
					{prompt === null
						? 'Přidejte si Pínu na plochu — v Safari přes Sdílet, jinde přes nabídku prohlížeče.'
						: 'Přidejte si Pínu na plochu telefonu.'}
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
