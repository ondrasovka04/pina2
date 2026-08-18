import { render } from '@testing-library/react'
import { vi } from 'vitest'

import { AppInstallCard } from '@/features/profile/AppInstallCard'

/** Dotykové zařízení, nebo počítač s myší. */
function pretendDevice(touch: boolean) {
	Object.defineProperty(navigator, 'maxTouchPoints', { value: touch ? 5 : 0, configurable: true })
	window.matchMedia = ((query: string) =>
		({
			matches: query.includes('any-pointer: coarse') ? touch : false,
			media: query,
			addEventListener: () => undefined,
			removeEventListener: () => undefined,
		}) as unknown as MediaQueryList) as typeof window.matchMedia
}

describe('AppInstallCard', () => {
	it('na počítači kartu vůbec neukáže', () => {
		pretendDevice(false)

		const { container } = render(<AppInstallCard />)

		expect(container).toBeEmptyDOMElement()
	})

	/**
	 * iPadOS se hlásí jako macOS, takže rozhodovat podle user agenta by kartu
	 * schovalo právě tam, kde je instalace k oznámením povinná.
	 */
	it('na dotykovém zařízení s macOS user agentem kartu ukáže', () => {
		pretendDevice(true)
		vi.spyOn(navigator, 'userAgent', 'get').mockReturnValue(
			'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 Version/17.0 Safari/605.1.15',
		)

		const { getByText } = render(<AppInstallCard />)

		expect(getByText('Aplikace v telefonu')).toBeInTheDocument()
	})
})
