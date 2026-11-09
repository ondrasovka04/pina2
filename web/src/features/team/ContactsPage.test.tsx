import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { TeamContact } from '@/lib/types'

vi.mock('@/app/team', () => ({ useTeam: () => ({ team: { id: 4, name: 'Muži' } }) }))

const get = vi.fn()

vi.mock('@/lib/api', async (importOriginal) => {
	const actual = await importOriginal<typeof import('@/lib/api')>()

	return { ...actual, api: { ...actual.api, get } }
})

const { ContactsPage } = await import('@/features/team/ContactsPage')

const contacts: TeamContact[] = [
	{ membershipId: 1, name: 'Kopis', avatarUrl: null, jerseyNumber: 7, phone: '+420777123456' },
	{ membershipId: 2, name: 'Vánis', avatarUrl: null, jerseyNumber: null, phone: null },
]

function renderPage() {
	const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })

	return render(
		<QueryClientProvider client={client}>
			<MemoryRouter>
				<ContactsPage />
			</MemoryRouter>
		</QueryClientProvider>,
	)
}

describe('ContactsPage', () => {
	beforeEach(() => {
		get.mockReset()
		get.mockResolvedValue({ contacts })
	})

	it('číslo volá přes tel:, kdo ho nemá, má „bez čísla" a žádné kopírování', async () => {
		renderPage()

		const call = await screen.findByRole('link', { name: '+420 777 123 456' })
		expect(call).toHaveAttribute('href', 'tel:+420777123456')
		expect(get).toHaveBeenCalledWith('/teams/4/contacts', expect.anything())

		expect(screen.getByText('bez čísla')).toBeInTheDocument()
		expect(screen.getAllByRole('button', { name: /Kopírovat číslo/ })).toHaveLength(1)
	})

	it('zkopíruje číslo bez mezer, aby šlo vložit do chatu', async () => {
		const user = userEvent.setup()
		const writeText = vi.fn().mockResolvedValue(undefined)
		Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true })
		renderPage()

		const copy = await screen.findByRole('button', { name: 'Kopírovat číslo: Kopis' })
		await user.click(copy)

		expect(writeText).toHaveBeenCalledWith('+420777123456')
		expect(copy).toHaveTextContent('Zkopírováno')
	})
})
