import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
	settings: vi.fn(),
	subscribe: vi.fn(),
	unsubscribe: vi.fn(),
	save: vi.fn(),
	current: vi.fn(),
	create: vi.fn(),
	input: vi.fn(),
	supports: vi.fn(),
	needsInstall: vi.fn(),
}))

vi.mock('@/lib/queries', () => ({
	useNotificationSettings: mocks.settings,
	useSubscribePush: () => ({ mutateAsync: mocks.subscribe, isPending: false, error: null }),
	useUnsubscribePush: () => ({ mutateAsync: mocks.unsubscribe, isPending: false, error: null }),
	useSaveNotificationPreferences: () => ({ mutateAsync: mocks.save, isPending: false, error: null }),
}))

vi.mock('@/lib/push', () => ({
	supportsPush: mocks.supports,
	needsInstallForPush: mocks.needsInstall,
	currentPushSubscription: mocks.current,
	createPushSubscription: mocks.create,
	pushSubscriptionInput: mocks.input,
}))

const { NotificationsCard } = await import('@/features/profile/NotificationsCard')

const settings = {
	available: true,
	publicKey: 'verejny-klic',
	subscriptionCount: 1,
	preferences: {
		eventReminder: true,
		offenceBatch: false,
	},
}

describe('NotificationsCard', () => {
	beforeEach(() => {
		mocks.settings.mockReturnValue({ data: settings, error: null, isPending: false })
		mocks.supports.mockReturnValue(true)
		mocks.needsInstall.mockReturnValue(false)
		mocks.current.mockResolvedValue(null)
		mocks.subscribe.mockResolvedValue(settings)
		mocks.save.mockResolvedValue({ preferences: settings.preferences })
		mocks.input.mockReturnValue({ endpoint: 'https://push.test/a', deviceId: 'a'.repeat(32) })
	})

	it('zobrazí bezpečné výchozí volby a dovolí aktivně zapnout peněžní kategorii', async () => {
		const user = userEvent.setup()
		render(<NotificationsCard />)

		expect(screen.getByRole('checkbox', { name: /Nezodpovězená akce/ })).toBeChecked()
		expect(screen.queryByRole('checkbox', { name: /nominace/i })).toBeNull()
		expect(screen.getByRole('checkbox', { name: /Nový zápis do píny/ })).not.toBeChecked()
		expect(screen.queryByRole('checkbox', { name: /dluh/i })).toBeNull()

		await user.click(screen.getByRole('checkbox', { name: /Nový zápis do píny/ }))

		expect(mocks.save).toHaveBeenCalledWith({ ...settings.preferences, offenceBatch: true })
	})

	it('vyžádá oprávnění až po kliknutí na zapnutí', async () => {
		const user = userEvent.setup()
		mocks.settings.mockReturnValue({
			data: { ...settings, subscriptionCount: 0 },
			error: null,
			isPending: false,
		})
		const browserSubscription = { endpoint: 'https://push.test/a' }
		mocks.create.mockResolvedValue(browserSubscription)
		render(<NotificationsCard />)

		await waitFor(() => expect(screen.getByRole('button', { name: 'Zapnout' })).toBeEnabled())
		expect(mocks.create).not.toHaveBeenCalled()

		await user.click(screen.getByRole('button', { name: 'Zapnout' }))

		expect(mocks.create).toHaveBeenCalledWith('verejny-klic')
		expect(mocks.subscribe).toHaveBeenCalledWith({ endpoint: 'https://push.test/a', deviceId: 'a'.repeat(32) })
	})

	/** Volby patří účtu, ale bez zapnutého zařízení nemají kam dorazit. */
	it('zamkne přepínače, dokud není zapnuté aspoň jedno zařízení', async () => {
		mocks.settings.mockReturnValue({
			data: { ...settings, subscriptionCount: 0 },
			error: null,
			isPending: false,
		})
		render(<NotificationsCard />)

		expect(screen.getByRole('checkbox', { name: /Nezodpovězená akce/ })).toBeDisabled()
		expect(screen.getByText(/až oznámení zapnete aspoň v jednom zařízení/)).toBeInTheDocument()
	})

	/** Zapínání trvá i pár sekund; do té doby nesmí jít přepínat nic dalšího. */
	it('po dobu zapínání drží přepínače i tlačítko zamčené', async () => {
		const user = userEvent.setup()
		mocks.settings.mockReturnValue({
			data: { ...settings, subscriptionCount: 0 },
			error: null,
			isPending: false,
		})
		// Zapínání zůstane rozjeté, dokud ho test sám nedokončí.
		let finish: ((subscription: unknown) => void) | undefined
		mocks.create.mockReturnValue(new Promise((resolve) => (finish = resolve)))
		render(<NotificationsCard />)

		await waitFor(() => expect(screen.getByRole('button', { name: 'Zapnout' })).toBeEnabled())
		await user.click(screen.getByRole('button', { name: 'Zapnout' }))

		await waitFor(() => expect(screen.getByRole('button', { name: /Zapnout/ })).toBeDisabled())
		expect(screen.getByRole('checkbox', { name: /Nezodpovězená akce/ })).toBeDisabled()

		finish?.({ endpoint: 'https://push.test/a' })
		await waitFor(() => expect(mocks.subscribe).toHaveBeenCalled())
	})

	/**
	 * Vypnuté tlačítko na kliknutí nic neudělá ani nenapíše. Kde to nejde, musí
	 * místo něj stát důvod — jinak to vypadá jako rozbitá aplikace.
	 */
	it('místo mrtvého tlačítka ukáže, proč to na zařízení nejde', async () => {
		mocks.needsInstall.mockReturnValue(true)
		render(<NotificationsCard />)

		expect(screen.queryByRole('button', { name: 'Zapnout' })).toBeNull()
		expect(screen.getByText(/Přidejte si Pínu a otevřete ji z ikony/)).toBeInTheDocument()

		mocks.needsInstall.mockReturnValue(false)
		mocks.settings.mockReturnValue({
			data: { ...settings, available: false, publicKey: null },
			error: null,
			isPending: false,
		})
		render(<NotificationsCard />)

		expect(screen.queryByRole('button', { name: 'Zapnout' })).toBeNull()
		expect(screen.getByText(/chybí mu VAPID klíče/)).toBeInTheDocument()
	})
})
