import { useRegisterSW } from 'virtual:pwa-register/react'

import { Button } from '@/components/ui/Button'

export function PwaUpdatePrompt() {
	const {
		needRefresh: [needRefresh, setNeedRefresh],
		updateServiceWorker,
	} = useRegisterSW()

	if (!needRefresh) {
		return null
	}

	return (
		<div
			role="status"
			className="border-line bg-surface-1 fixed inset-x-3 bottom-24 z-50 mx-auto flex max-w-lg items-center gap-3 rounded-xl border p-3 shadow-xl md:bottom-4"
		>
			<p className="min-w-0 flex-1 text-sm">Je dostupná nová verze aplikace.</p>
			<Button size="sm" variant="accent" onClick={() => void updateServiceWorker(true)}>
				Načíst
			</Button>
			<button
				type="button"
				aria-label="Zavřít"
				className="text-ink-muted hover:text-ink grid size-11 shrink-0 place-items-center text-xl"
				onClick={() => setNeedRefresh(false)}
			>
				×
			</button>
		</div>
	)
}
