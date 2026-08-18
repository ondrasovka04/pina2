import { fireEvent, render } from '@testing-library/react'

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
})
