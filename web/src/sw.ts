/// <reference lib="webworker" />

import { clientsClaim } from 'workbox-core'
import { cleanupOutdatedCaches, createHandlerBoundToURL, precacheAndRoute } from 'workbox-precaching'
import { NavigationRoute, registerRoute } from 'workbox-routing'

declare let self: ServiceWorkerGlobalScope & {
	// Workbox při sestavení nahradí tenhle přesný identifikátor seznamem souborů.
	// oxlint-disable-next-line no-underscore-dangle
	__WB_MANIFEST: Array<unknown>
}

clientsClaim()
// oxlint-disable-next-line no-underscore-dangle
const precache = self.__WB_MANIFEST
precacheAndRoute(precache)
cleanupOutdatedCaches()

// Navigace dostane aplikační shell, aby se PWA spustila i bez signálu.
// Odpovědi API se **necachují vůbec** — ani ke čtení: bez sítě se nedá obnovit
// přihlášení, takže by z toho stejně byla jen přihlašovací obrazovka, a soukromá
// data by zbytečně ležela v zařízení. Zápisy se necachují ani nefrontují.
//
// Podmínka je kvůli vývoji: tam je precache prázdná, `/index.html` v ní není
// a `createHandlerBoundToURL` na to vyhodí výjimku. Ta shodí celý skript, takže
// se service worker vůbec nenainstaluje — a s ním tiše přestanou fungovat
// i oznámení, protože `serviceWorker.ready` se pak nikdy nesplní.
if (precache.length > 0) {
	registerRoute(new NavigationRoute(createHandlerBoundToURL('/index.html')))
}

self.addEventListener('message', (event) => {
	if (event.data?.type === 'SKIP_WAITING') {
		void self.skipWaiting()
	}
})

self.addEventListener('push', (event) => {
	const fallback = { title: 'Pína', body: 'V aplikaci je nové oznámení.', link: '/' }
	let data = fallback

	try {
		data = { ...fallback, ...(event.data?.json() as Partial<typeof fallback>) }
	} catch {
		// Poškozené tělo nesmí zahodit celé oznámení.
	}

	event.waitUntil(
		self.registration.showNotification(data.title, {
			body: data.body,
			icon: '/pwa-192.png',
			badge: '/favicon-32.png',
			data: { link: data.link },
		}),
	)
})

self.addEventListener('notificationclick', (event) => {
	event.notification.close()
	const link = typeof event.notification.data?.link === 'string' ? event.notification.data.link : '/'

	event.waitUntil(
		self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clients) => {
			const target = new URL(link, self.location.origin).href
			for (const client of clients) {
				if ('focus' in client) {
					return client.navigate(target).then(() => client.focus())
				}
			}

			return self.clients.openWindow(target)
		}),
	)
})
