import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'

import { PaymentVoidDialog } from '@/features/balances/PaymentVoidDialog'

describe('PaymentVoidDialog', () => {
	it('nepovolí storno bez důvodu a odevzdá oříznutý text', async () => {
		const user = userEvent.setup()
		const confirm = vi.fn()

		render(<PaymentVoidDialog open onConfirm={confirm} onCancel={() => undefined} />)

		const button = screen.getByRole('button', { name: 'Stornovat' })
		expect(button).toBeDisabled()

		await user.type(screen.getByLabelText('Důvod storna'), '  Platba je dvakrát  ')
		expect(button).toBeEnabled()
		await user.click(button)

		expect(confirm).toHaveBeenCalledWith('Platba je dvakrát')
	})
})
