import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { ApiError } from '@/lib/api'
import type { InvitationPreview } from '@/lib/types'

const state = vi.hoisted(() => ({
	preview: undefined as InvitationPreview | undefined,
	error: null as unknown,
	acceptInvitation: vi.fn(),
}))

vi.mock('@/app/session', () => ({
	useSession: () => ({ acceptInvitation: state.acceptInvitation, user: null }),
}))

vi.mock('@/lib/queries', () => ({
	useInvitationPreview: () => ({
		isPending: state.preview === undefined && state.error === null,
		error: state.error,
		data: state.preview,
	}),
}))

const { AcceptInvitationPage } = await import('@/features/auth/AcceptInvitationPage')

function preview(overrides: Partial<InvitationPreview> = {}): InvitationPreview {
	return {
		email: 'hrac@prosek.cz',
		teamName: 'Prosek - muži',
		role: 'player',
		name: null,
		hasPassword: false,
		...overrides,
	}
}

function renderPage(token = 'abc123') {
	return render(
		<MemoryRouter initialEntries={[`/pozvanka?token=${token}`]}>
			<AcceptInvitationPage />
		</MemoryRouter>,
	)
}

beforeEach(() => {
	state.preview = undefined
	state.error = null
	state.acceptInvitation.mockReset()
	state.acceptInvitation.mockResolvedValue(undefined)
})

describe('AcceptInvitationPage', () => {
	it('bez tokenu v adrese žádá o nový odkaz', () => {
		renderPage('')

		expect(screen.getByText('Odkaz není úplný')).toBeInTheDocument()
	})

	it('než dorazí náhled, ukazuje že se ověřuje', () => {
		renderPage()

		expect(screen.getByText('Ověřuji pozvánku…')).toBeInTheDocument()
	})

	it('neplatný nebo prošlý token ukáže hlášku ze serveru', () => {
		state.error = new ApiError(400, 'VALIDATION_FAILED', 'Platnost pozvánky vypršela, požádejte o novou.')
		renderPage()

		expect(screen.getByText('Platnost pozvánky vypršela, požádejte o novou.')).toBeInTheDocument()
	})

	it('nový účet se ptá na jméno i heslo', async () => {
		const user = userEvent.setup()
		state.preview = preview()
		renderPage()

		await user.type(screen.getByLabelText('Jméno'), 'Nový Hráč')
		await user.type(screen.getByLabelText('Heslo'), 'opravdu-dlouhe-heslo')
		await user.type(screen.getByLabelText('Heslo ještě jednou'), 'opravdu-dlouhe-heslo')
		await user.click(screen.getByRole('button', { name: 'Vstoupit do aplikace' }))

		await waitFor(() =>
			expect(state.acceptInvitation).toHaveBeenCalledWith('abc123', 'opravdu-dlouhe-heslo', 'Nový Hráč'),
		)
	})

	it('účet, který má heslo z jiného družstva, se na nic neptá', async () => {
		const user = userEvent.setup()
		state.preview = preview({ hasPassword: true, name: 'Obojživelník' })
		renderPage()

		expect(screen.queryByLabelText('Heslo')).not.toBeInTheDocument()
		expect(screen.getByText(/Obojživelník/)).toBeInTheDocument()

		await user.click(screen.getByRole('button', { name: 'Přidat se do družstva' }))

		await waitFor(() => expect(state.acceptInvitation).toHaveBeenCalledWith('abc123', null, null))
	})
})
