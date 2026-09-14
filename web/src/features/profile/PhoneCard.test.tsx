import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'
import { setupServer } from 'msw/node'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

import { PhoneCard } from './PhoneCard'

const session = vi.hoisted(() => ({ phone: null as string | null, refreshUser: vi.fn() }))
vi.mock('@/app/session', () => ({
	useCurrentUser: () => ({ phone: session.phone }),
	useSession: () => ({ refreshUser: session.refreshUser }),
}))

const server = setupServer()
beforeAll(() => server.listen({ onUnhandledRequest: 'error' }))
afterEach(() => server.resetHandlers())
afterAll(() => server.close())
beforeEach(() => {
	session.phone = null
	session.refreshUser.mockReset().mockResolvedValue(undefined)
})

function renderCard() {
	const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })
	client.setQueryData(['teams', 1, 'members'], [{ phone: null }])
	render(
		<QueryClientProvider client={client}>
			<PhoneCard />
		</QueryClientProvider>,
	)
	return client
}

describe('Telefon v profilu', () => {
	it('uloží číslo přes API, zobrazí normalizovaný tvar a zneplatní seznam členů', async () => {
		let body: unknown
		server.use(
			http.put('/api/v1/me/phone', async ({ request }) => {
				body = await request.json()
				return HttpResponse.json({ phone: '+420777123456' })
			}),
		)
		const client = renderCard()
		const user = userEvent.setup()
		await user.type(screen.getByRole('textbox'), '777 123 456')
		await user.click(screen.getByRole('button', { name: 'Uložit telefon' }))
		expect(await screen.findByRole('status')).toHaveTextContent('Telefon je uložený.')
		expect(body).toEqual({ phone: '777 123 456' })
		expect(screen.getByRole('textbox')).toHaveValue('+420 777 123 456')
		expect(session.refreshUser).toHaveBeenCalledOnce()
		expect(client.getQueryState(['teams', 1, 'members'])?.isInvalidated).toBe(true)
	})

	it('umožní uložené číslo smazat', async () => {
		session.phone = '+420777123456'
		let body: unknown
		server.use(
			http.put('/api/v1/me/phone', async ({ request }) => {
				body = await request.json()
				return HttpResponse.json({ phone: null })
			}),
		)
		renderCard()
		const user = userEvent.setup()
		expect(screen.getByRole('textbox')).toHaveValue('+420 777 123 456')
		await user.clear(screen.getByRole('textbox'))
		await user.click(screen.getByRole('button', { name: 'Uložit telefon' }))
		await screen.findByRole('status')
		expect(body).toEqual({ phone: null })
		expect(screen.getByRole('textbox')).toHaveValue('')
	})

	it('ukáže chybu serveru u pole a zachová rozepsané číslo', async () => {
		server.use(
			http.put('/api/v1/me/phone', () =>
				HttpResponse.json(
					{
						error: { code: 'VALIDATION_ERROR', message: 'Zadejte české číslo.', details: { field: 'phone' } },
					},
					{ status: 400 },
				),
			),
		)
		renderCard()
		const user = userEvent.setup()
		await user.type(screen.getByRole('textbox'), '123')
		await user.click(screen.getByRole('button', { name: 'Uložit telefon' }))
		expect(await screen.findByRole('alert')).toHaveTextContent('Zadejte české číslo.')
		expect(screen.getByRole('textbox')).toHaveValue('123')
		expect(screen.getByRole('textbox')).toHaveAttribute('aria-invalid', 'true')
		expect(screen.queryByRole('status')).toBeNull()
		expect(session.refreshUser).not.toHaveBeenCalled()
	})

	it('nehlásí uložené číslo jako ztracené, když selže obnovení profilu', async () => {
		session.refreshUser.mockRejectedValue(new Error('Výpadek sítě'))
		server.use(http.put('/api/v1/me/phone', () => HttpResponse.json({ phone: null })))
		renderCard()
		await userEvent.setup().click(screen.getByRole('button', { name: 'Uložit telefon' }))
		expect(await screen.findByRole('status')).toHaveTextContent('Telefon je uložený.')
		expect(screen.queryByRole('alert')).toBeNull()
	})
})
