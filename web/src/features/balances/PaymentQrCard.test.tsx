import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
	usePaymentQr: vi.fn(),
	toDataURL: vi.fn(),
}))

vi.mock('@/lib/queries', () => ({ usePaymentQr: mocks.usePaymentQr }))
vi.mock('qrcode', () => ({ default: { toDataURL: mocks.toDataURL } }))

const { PaymentQrCard } = await import('@/features/balances/PaymentQrCard')

function query(data: Record<string, unknown>) {
	return {
		data,
		isPending: false,
		error: null,
		refetch: vi.fn(),
	}
}

describe('PaymentQrCard', () => {
	beforeEach(() => {
		mocks.usePaymentQr.mockReset()
		mocks.toDataURL.mockReset()
	})

	it('při načítání nevykreslí nic, aby na stránce neposkakovalo místo', () => {
		mocks.usePaymentQr.mockReturnValue({ data: undefined, isPending: true, error: null, refetch: vi.fn() })

		const { container } = render(<PaymentQrCard seasonId={1} membershipId={2} />)

		expect(container).toBeEmptyDOMElement()
	})

	it('chybu hlásí drobně a s možností zkusit znovu', async () => {
		const refetch = vi.fn()
		mocks.usePaymentQr.mockReturnValue({ data: undefined, isPending: false, error: new Error('mimo'), refetch })

		render(<PaymentQrCard seasonId={1} membershipId={2} />)
		await userEvent.setup().click(screen.getByRole('button', { name: 'Zkusit znovu' }))

		expect(refetch).toHaveBeenCalledOnce()
	})

	it('bez kladného dluhu kartu vůbec neukáže', () => {
		mocks.usePaymentQr.mockReturnValue(query({ amountCzk: 0, spayd: null }))

		const { container } = render(<PaymentQrCard seasonId={1} membershipId={2} />)

		expect(container).toBeEmptyDOMElement()
	})

	it('po kliknutí vykreslí QR se správnou částkou a platebními údaji', async () => {
		mocks.toDataURL.mockResolvedValue('data:image/png;base64,qr')
		mocks.usePaymentQr.mockReturnValue(
			query({
				amountCzk: 250,
				variableSymbol: '10420037',
				bankAccount: '19-2000145399/0800',
				spayd: 'SPD*1.0*ACC:CZ6508000000192000145399*AM:250.00',
				period: { name: '1. polovina 26/27', from: '2026-09-01', to: '2027-01-30' },
			}),
		)

		const user = userEvent.setup()
		render(<PaymentQrCard seasonId={1} membershipId={2} />)
		await user.click(screen.getByRole('button', { name: 'Zobrazit QR platbu' }))

		expect(await screen.findByRole('img', { name: 'QR platba 250 Kč' })).toHaveAttribute(
			'src',
			'data:image/png;base64,qr',
		)
		expect(mocks.toDataURL).toHaveBeenCalledWith(expect.stringContaining('AM:250.00'), expect.any(Object))
		expect(screen.getByText(/VS 10420037/)).toBeInTheDocument()
	})
})
