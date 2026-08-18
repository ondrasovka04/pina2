import type { PushSubscriptionInput } from '@/lib/types'

const READY_TIMEOUT_MS = 5000

export function supportsPush(): boolean {
	return 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window
}

/**
 * iPhone a iPad pustí Web Push jedině aplikaci přidané na plochu — v Safari na
 * webu `subscribe()` skončí chybou. Na počítači to platí i pro Safari naopak:
 * tam instalace potřeba není. iPadOS se hlásí jako Macintosh, takže se pozná
 * podle dotykové obrazovky.
 */
export function needsInstallForPush(): boolean {
	const apple =
		/iPad|iPhone|iPod/.test(navigator.userAgent) ||
		(/Macintosh/.test(navigator.userAgent) && navigator.maxTouchPoints > 1)
	if (!apple) return false

	const standalone = window.matchMedia('(display-mode: standalone)').matches

	return !standalone
}

export async function currentPushSubscription(): Promise<PushSubscription | null> {
	if (!supportsPush()) return null

	const registration = await navigator.serviceWorker.getRegistration()
	return registration === undefined ? null : registration.pushManager.getSubscription()
}

export async function createPushSubscription(publicKey: string): Promise<PushSubscription> {
	if (!supportsPush()) throw new Error('Tento prohlížeč oznámení nepodporuje.')

	const permission = await Notification.requestPermission()
	if (permission !== 'granted') throw new Error('Oznámení nejsou v prohlížeči povolená.')

	const registration = await activeRegistration()
	const existing = await registration.pushManager.getSubscription()
	if (existing !== null) return existing

	return registration.pushManager.subscribe({
		userVisibleOnly: true,
		applicationServerKey: decodeBase64Url(publicKey),
	})
}

export function pushSubscriptionInput(subscription: PushSubscription): PushSubscriptionInput {
	const p256dh = subscription.getKey('p256dh')
	const auth = subscription.getKey('auth')
	if (p256dh === null || auth === null) throw new Error('Prohlížeč neposkytl klíče oznámení.')

	return {
		endpoint: subscription.endpoint,
		p256dh: encodeBase64Url(p256dh),
		auth: encodeBase64Url(auth),
		contentEncoding: 'aes128gcm',
		deviceId: deviceId(),
	}
}

/**
 * Trvalá identita prohlížeče. Adresu odběru vydává push služba a **při každé nové
 * registraci service workera je jiná**, takže se podle ní nedá poznat, že jde
 * o totéž zařízení — server pak po jednom telefonu držel několik mrtvých odběrů
 * a aplikace tvrdila „aktivní na jiném zařízení". Tohle je jediná věc, kterou si
 * klient ukládá natrvalo; nic neprozrazuje a po smazání dat webu vznikne nová.
 */
function deviceId(): string {
	const key = 'pina-device'
	const stored = localStorage.getItem(key)
	if (stored !== null && /^[a-f0-9]{32}$/.test(stored)) return stored

	const created = [...crypto.getRandomValues(new Uint8Array(16))]
		.map((byte) => byte.toString(16).padStart(2, '0'))
		.join('')
	localStorage.setItem(key, created)

	return created
}

/**
 * `serviceWorker.ready` se nesplní **nikdy**, když se worker nepodaří
 * nainstalovat. Bez limitu by tlačítko „Zapnout" jen tiše zamrzlo: žádná chyba
 * v konzoli, žádný požadavek, nic. Radši ať uživatel dostane hlášku.
 */
async function activeRegistration(): Promise<ServiceWorkerRegistration> {
	let timer: ReturnType<typeof setTimeout> | undefined

	try {
		return await Promise.race([
			navigator.serviceWorker.ready,
			new Promise<never>((_, reject) => {
				timer = setTimeout(
					() => reject(new Error('Aplikace na pozadí se nespustila. Načtěte stránku znovu a zkuste to zase.')),
					READY_TIMEOUT_MS,
				)
			}),
		])
	} finally {
		clearTimeout(timer)
	}
}

function decodeBase64Url(value: string): Uint8Array<ArrayBuffer> {
	const padding = '='.repeat((4 - (value.length % 4)) % 4)
	const binary = atob((value + padding).replaceAll('-', '+').replaceAll('_', '/'))

	return Uint8Array.from(binary, (character) => character.charCodeAt(0))
}

function encodeBase64Url(value: ArrayBuffer): string {
	const binary = String.fromCharCode(...new Uint8Array(value))

	return btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '')
}
