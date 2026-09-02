import { useEffect, useState } from 'react'

import { useTeam } from '@/app/team'
import { Button } from '@/components/ui/Button'
import { Card, CardHeader } from '@/components/ui/Card'
import { cn } from '@/lib/cn'
import {
	createPushSubscription,
	currentPushSubscription,
	needsInstallForPush,
	pushSubscriptionInput,
	supportsPush,
} from '@/lib/push'
import {
	useNotificationSettings,
	useSaveNotificationPreferences,
	useSubscribePush,
	useUnsubscribePush,
} from '@/lib/queries'
import type { NotificationPreferences } from '@/lib/types'

const options: Array<{ key: keyof NotificationPreferences; label: string; description: string }> = [
	{
		key: 'eventReminder',
		label: 'Nezodpovězená akce',
		description: 'Než vyprší termín zápisu, pokud chybí odpověď.',
	},
	{ key: 'offenceBatch', label: 'Nový zápis do píny', description: 'Jeden souhrn za celou dávku.' },
]

/**
 * Proč to na tomhle zařízení nejde — nebo `null`, když jde. Na počítači žádná
 * instalace potřeba není, ani v Safari; brání jen iPhone a iPad.
 */
function blockedReason(available: boolean | undefined): string | null {
	if (!supportsPush()) return 'Tenhle prohlížeč oznámení neumí. Zkuste Chrome nebo Safari.'
	if (needsInstallForPush())
		return 'iPhone a iPad oznámení povolí až aplikaci na ploše. Přidejte si Pínu a otevřete ji z ikony.'
	if (available === false) return 'Server oznámení zatím nemá nastavená, chybí mu VAPID klíče.'

	return null
}

export function NotificationsCard() {
	const { teams } = useTeam()
	const visibleOptions = teams.some((team) => team.attendanceEnabled)
		? options
		: options.filter((option) => option.key !== 'eventReminder')
	const settings = useNotificationSettings()
	const subscribe = useSubscribePush()
	const unsubscribe = useUnsubscribePush()
	const savePreferences = useSaveNotificationPreferences()
	const [deviceSubscription, setDeviceSubscription] = useState<PushSubscription | null>(null)
	const [checkingDevice, setCheckingDevice] = useState(true)
	const [localError, setLocalError] = useState<string | null>(null)
	/**
	 * Zapnutí trvá i pár sekund a většina toho času padne na prohlížeč — dotaz na
	 * povolení a registraci u push služby. `subscribe.isPending` se zvedne teprve
	 * potom, takže samo o sobě nechá tlačítko vypadat, že se nic neděje.
	 */
	const [working, setWorking] = useState(false)

	useEffect(() => {
		let cancelled = false
		void currentPushSubscription()
			.then((subscription) => {
				if (!cancelled) setDeviceSubscription(subscription)
			})
			.finally(() => {
				if (!cancelled) setCheckingDevice(false)
			})

		return () => {
			cancelled = true
		}
	}, [])

	async function enable() {
		const publicKey = settings.data?.publicKey
		if (publicKey == null) return

		setLocalError(null)
		setWorking(true)
		try {
			const subscription = await createPushSubscription(publicKey)
			await subscribe.mutateAsync(pushSubscriptionInput(subscription))
			setDeviceSubscription(subscription)
		} catch (cause) {
			setLocalError(cause instanceof Error ? cause.message : 'Oznámení se nepodařilo zapnout.')
		} finally {
			setWorking(false)
		}
	}

	async function disable() {
		if (deviceSubscription === null) return

		setLocalError(null)
		setWorking(true)
		try {
			await unsubscribe.mutateAsync(deviceSubscription.endpoint)
			await deviceSubscription.unsubscribe()
			setDeviceSubscription(null)
		} catch (cause) {
			setLocalError(cause instanceof Error ? cause.message : 'Oznámení se nepodařilo vypnout.')
		} finally {
			setWorking(false)
		}
	}

	function toggle(key: keyof NotificationPreferences) {
		const current = settings.data?.preferences
		if (current === undefined) return

		void savePreferences.mutateAsync({ ...current, [key]: !current[key] }).catch(() => undefined)
	}

	const error = localError ?? settings.error?.message ?? subscribe.error?.message ?? unsubscribe.error?.message
	const busy = checkingDevice || working || subscribe.isPending || unsubscribe.isPending
	const blocked = blockedReason(settings.data?.available)
	/**
	 * Volby patří účtu, ne zařízení — zapnuté oznámení na telefonu platí i tady.
	 * Dokud ale není zapnuté ani jedno zařízení, nemají kam dorazit a přepínat je
	 * nemá smysl.
	 */
	const deliverable = (settings.data?.subscriptionCount ?? 0) > 0
	/**
	 * Přepínat volby jde jen tam, kam mají dorazit, a ne během zapínání zařízení.
	 * Ukládání volby samotné se sem **nepočítá**: zešednutí na dobu požadavku
	 * probliklo celým seznamem po každém cvaknutí. Přepínač se překlopí hned
	 * a při chybě se vrátí, viz `useSaveNotificationPreferences`.
	 */
	const locked = !deliverable || busy

	return (
		<Card id="oznameni" className="scroll-mt-4">
			<CardHeader title="Oznámení" subtitle="Volby platí jen pro váš účet." />

			<div className="border-line/50 flex items-center justify-between gap-3 border-b p-4">
				<div className="min-w-0">
					<p className="font-medium">Oznámení v tomto zařízení</p>
					<p className="text-ink-muted mt-0.5 text-sm">
						{blocked ??
							(deviceSubscription === null
								? settings.data !== undefined && settings.data.subscriptionCount > 0
									? 'Aktivní na jiném zařízení.'
									: 'Vypnutá'
								: 'Zapnutá')}
					</p>
				</div>

				{/* Vypnuté tlačítko na kliknutí nic neudělá ani nenapíše, takže se
				    tam, kde to nejde, nevykresluje vůbec — důvod stojí místo něj. */}
				{blocked !== null ? null : deviceSubscription === null ? (
					<Button size="sm" loading={busy} disabled={settings.isPending} onClick={() => void enable()}>
						Zapnout
					</Button>
				) : (
					<Button size="sm" variant="ghost" loading={busy} onClick={() => void disable()}>
						Vypnout
					</Button>
				)}
			</div>

			{settings.data === undefined ? (
				<p className="text-ink-faint px-4 py-3 text-sm">Načítám volby…</p>
			) : (
				<div className="divide-line/50 divide-y">
					{visibleOptions.map((option) => (
						<label
							key={option.key}
							className={cn(
								'flex min-h-16 items-center justify-between gap-4 px-4 py-3',
								locked ? 'cursor-not-allowed opacity-50' : 'cursor-pointer',
							)}
						>
							<span className="min-w-0">
								<span className="block text-sm font-medium">{option.label}</span>
								<span className="text-ink-muted mt-0.5 block text-xs">{option.description}</span>
							</span>
							<input
								type="checkbox"
								className="peer sr-only"
								checked={settings.data.preferences[option.key]}
								disabled={locked}
								onChange={() => toggle(option.key)}
							/>
							<span className="bg-surface-3 peer-checked:bg-accent peer-focus-visible:outline-accent relative h-7 w-12 shrink-0 rounded-full transition-colors peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 after:absolute after:top-1 after:left-1 after:size-5 after:rounded-full after:bg-white after:transition-transform peer-checked:after:translate-x-5" />
						</label>
					))}
				</div>
			)}

			{blocked !== null || deliverable || settings.data === undefined ? null : (
				<p className="text-ink-faint border-line/50 border-t px-4 py-3 text-sm">
					Volby začnou platit, až oznámení zapnete aspoň v jednom zařízení.
				</p>
			)}

			{error == null && savePreferences.error === null ? null : (
				<p role="alert" className="text-debt border-line/50 border-t px-4 py-3 text-sm">
					{error ?? savePreferences.error?.message}
				</p>
			)}
		</Card>
	)
}
