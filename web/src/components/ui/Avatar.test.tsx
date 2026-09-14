import { fireEvent, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { StrictMode } from 'react'

import { Avatar, initials } from '@/components/ui/Avatar'

describe('Avatar', () => {
	it('vytvoří iniciály z prvního a posledního slova', () => {
		expect(initials('  Ondřej Jan Kopáč ')).toBe('OK')
		expect(initials('Pína')).toBe('P')
	})

	it('zobrazí obrázek a při chybě se vrátí k číslu dresu', () => {
		const { container, getByText } = render(<Avatar name="Ondřej Kopáč" src="/avatar.png" jerseyNumber={12} />)
		const image = container.querySelector('img')

		expect(image).not.toBeNull()
		fireEvent.error(image!)
		expect(getByText('12')).toBeInTheDocument()
	})

	it('zvětší fotku, klik na obrázek ji nezavře a křížek obnoví posouvání stránky', async () => {
		const user = userEvent.setup()
		render(
			<StrictMode>
				<Avatar name="Ondra" src="/avatar.png" preview />
			</StrictMode>,
		)

		await user.click(screen.getByRole('button', { name: 'Zvětšit profilovou fotku: Ondra' }))
		const dialog = screen.getByRole('dialog', { name: 'Ondra' })
		const image = within(dialog).getByRole('img', { name: 'Profilová fotka: Ondra' })
		expect(image).toHaveAttribute('src', '/avatar.png')
		expect(document.body.style.overflow).toBe('hidden')
		await user.click(image)
		expect(dialog).toBeInTheDocument()
		await user.click(within(dialog).getByRole('button', { name: 'Zavřít náhled' }))
		expect(screen.queryByRole('dialog')).toBeNull()
		expect(document.body.style.overflow).toBe('')
		expect(screen.getByRole('button', { name: 'Zvětšit profilovou fotku: Ondra' })).toHaveFocus()
	})

	it('zavře náhled kliknutím na podklad i nativním Escape', async () => {
		const user = userEvent.setup()
		render(<Avatar name="Ondra" src="/avatar.png" preview />)
		const trigger = screen.getByRole('button')
		await user.click(trigger)
		fireEvent.click(screen.getByRole('dialog'))
		expect(screen.queryByRole('dialog')).toBeNull()
		await user.click(trigger)
		fireEvent(screen.getByRole('dialog'), new Event('cancel', { cancelable: true }))
		expect(screen.queryByRole('dialog')).toBeNull()
	})

	it('nenabízí zvětšení iniciál ani rozbitého obrázku', () => {
		const { rerender, container } = render(<Avatar name="Ondra" preview />)
		expect(screen.queryByRole('button')).toBeNull()
		rerender(<Avatar name="Ondra" src="/broken.png" jerseyNumber={7} preview />)
		fireEvent.error(container.querySelector('img')!)
		expect(screen.queryByRole('button')).toBeNull()
		expect(screen.getByText('7')).toBeInTheDocument()
	})

	it('bez výslovného zapnutí nechává profilovku neklikací', () => {
		render(<Avatar name="Ondra" src="/avatar.png" />)
		expect(screen.queryByRole('button')).toBeNull()
	})

	it('při odchodu ze stránky odemkne posouvání a při změně hráče zavře fotku', async () => {
		const user = userEvent.setup()
		const { rerender, unmount } = render(<Avatar name="Ondra" src="/avatar.png" preview />)
		await user.click(screen.getByRole('button'))
		rerender(<Avatar name="Karel" src="/karel.png" preview />)
		expect(screen.queryByRole('dialog')).toBeNull()
		expect(document.body.style.overflow).toBe('')
		await user.click(screen.getByRole('button'))
		unmount()
		expect(document.body.style.overflow).toBe('')
	})

	it('při selhání velké fotky ponechá možnost náhled zavřít', async () => {
		const user = userEvent.setup()
		render(<Avatar name="Ondra" src="/avatar.png" preview />)
		await user.click(screen.getByRole('button'))
		fireEvent.error(screen.getByRole('img', { name: 'Profilová fotka: Ondra' }))
		expect(screen.getByRole('status')).toHaveTextContent('Fotku se nepodařilo načíst.')
		await user.click(screen.getByRole('button', { name: 'Zavřít náhled' }))
		expect(screen.queryByRole('dialog')).toBeNull()
	})
})
