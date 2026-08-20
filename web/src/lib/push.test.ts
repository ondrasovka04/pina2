import { afterEach, describe, expect, it, vi } from 'vitest'

import { createPushSubscription, needsInstallForPush, pushSubscriptionInput } from '@/lib/push'

/**
 * Prohlížeč se popisuje třemi nezávislými věcmi: umí push, běží z plochy,
 * má dotyk. Podle systému se nerozhoduje schválně — viz `needsInstallForPush`.
 */
function pretendBrowser({ push, standalone, touch }: { push: boolean; standalone: boolean; touch: boolean }) {
	Object.defineProperty(navigator, 'maxTouchPoints', { value: touch ? 5 : 0, configurable: true })
	vi.stubGlobal('Notification', { requestPermission: () => Promise.resolve('granted') })

	// `supportsPush()` chce tři věci naráz; jsdom nemá ani service workera.
	if (push) {
		vi.stubGlobal('PushManager', function PushManager() {})
		Object.defineProperty(navigator, 'serviceWorker', { value: {}, configurable: true })
	} else {
		Reflect.deleteProperty(globalThis, 'PushManager')
		Reflect.deleteProperty(navigator, 'serviceWorker')
	}

	window.matchMedia = ((query: string) =>
		({
			matches: query.includes('display-mode: standalone') ? standalone : query.includes('any-pointer: coarse') && touch,
			media: query,
			addEventListener: () => undefined,
			removeEventListener: () => undefined,
		}) as unknown as MediaQueryList) as typeof window.matchMedia
}

describe('needsInstallForPush', () => {
	afterEach(() => {
		vi.unstubAllGlobals()
	})

	/**
	 * iPad v Safari: `PushManager` v kartě neexistuje a iPadOS se přitom hlásí
	 * jako macOS, takže podle user agenta bychom instalaci neporadili právě
	 * tam, kde je povinná.
	 */
	it('poradí instalaci dotykovému zařízení bez push v kartě', () => {
		pretendBrowser({ push: false, standalone: false, touch: true })
		vi.spyOn(navigator, 'userAgent', 'get').mockReturnValue(
			'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 Version/17.0 Safari/605.1.15',
		)

		expect(needsInstallForPush()).toBe(true)
	})

	it('v nainstalované aplikaci už instalaci neradí', () => {
		pretendBrowser({ push: true, standalone: true, touch: true })

		expect(needsInstallForPush()).toBe(false)
	})

	/** Android i počítače push v kartě umí — instalace by byla rada pro nic. */
	it('neradí nic tam, kde push v kartě funguje', () => {
		pretendBrowser({ push: true, standalone: false, touch: true })

		expect(needsInstallForPush()).toBe(false)
	})

	/**
	 * Na počítači bez push instalace nepomůže: takový prohlížeč push neumí
	 * vůbec, a nabídnout tam „přidejte na plochu" by byla lež.
	 */
	it('neradí instalaci počítači, který push neumí', () => {
		pretendBrowser({ push: false, standalone: false, touch: false })

		expect(needsInstallForPush()).toBe(false)
	})
})

describe('pushSubscriptionInput', () => {
	it('převede klíče prohlížeče do base64url bez výplně', () => {
		const subscription = {
			endpoint: 'https://push.example.test/abc',
			getKey: (name: string) =>
				name === 'p256dh' ? Uint8Array.from([251, 255]).buffer : Uint8Array.from([1, 2, 3]).buffer,
		} as unknown as PushSubscription

		expect(pushSubscriptionInput(subscription)).toEqual({
			endpoint: 'https://push.example.test/abc',
			p256dh: '-_8',
			auth: 'AQID',
			contentEncoding: 'aes128gcm',
			deviceId: expect.stringMatching(/^[a-f0-9]{32}$/),
		})
	})

	/**
	 * Identita zařízení musí přežít, jinak by po sobě jeden prohlížeč nechával
	 * mrtvé odběry a aplikace by tvrdila, že je oznámení zapnuté někde jinde.
	 */
	it('drží stejnou identitu zařízení mezi voláními', () => {
		const subscription = {
			endpoint: 'https://push.example.test/abc',
			getKey: () => Uint8Array.from([1]).buffer,
		} as unknown as PushSubscription

		expect(pushSubscriptionInput(subscription).deviceId).toBe(pushSubscriptionInput(subscription).deviceId)
		expect(localStorage.getItem('pina-device')).toMatch(/^[a-f0-9]{32}$/)
	})
})

describe('createPushSubscription', () => {
	afterEach(() => {
		vi.useRealTimers()
		vi.unstubAllGlobals()
	})

	/**
	 * Když se service worker nenainstaluje, `ready` se nesplní nikdy a tlačítko
	 * „Zapnout" dřív jen tiše zamrzlo — bez chyby v konzoli i bez požadavku.
	 */
	it('nezůstane viset, když se service worker nespustí', async () => {
		vi.useFakeTimers()
		vi.stubGlobal('Notification', { requestPermission: () => Promise.resolve('granted') })
		// `supportsPush()` hlídá jen existenci, obsah je mu jedno.
		vi.stubGlobal('PushManager', function PushManager() {})
		vi.stubGlobal('navigator', {
			serviceWorker: { ready: new Promise<never>(() => {}) },
		})

		const attempt = createPushSubscription('verejny-klic')
		const assertion = expect(attempt).rejects.toThrow(/Načtěte stránku znovu/)
		await vi.advanceTimersByTimeAsync(5000)

		await assertion
	})
})
