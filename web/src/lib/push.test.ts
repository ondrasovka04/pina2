import { afterEach, describe, expect, it, vi } from 'vitest'

import { createPushSubscription, pushSubscriptionInput } from '@/lib/push'

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
