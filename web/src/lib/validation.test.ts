import { describe, expect, it } from 'vitest'

import { emailError, requiredError } from '@/lib/validation'

describe('emailError', () => {
	it('propustí běžnou adresu', () => {
		expect(emailError('jan.novak@seznam.cz')).toBeUndefined()
	})

	it('propustí adresu s mezerami kolem — ty se stejně ořežou', () => {
		expect(emailError('  jan@seznam.cz  ')).toBeUndefined()
	})

	it('hlásí prázdné pole', () => {
		expect(emailError('   ')).toBe('Vyplňte e-mail.')
	})

	it.each([['dsaas'], ['jan@'], ['@seznam.cz'], ['jan@seznam'], ['jan novak@seznam.cz'], ['jan@sez nam.cz']])(
		'odmítne %s',
		(value) => {
			expect(emailError(value)).toMatch(/platný tvar/)
		},
	)
})

describe('requiredError', () => {
	it('mlčí u vyplněné hodnoty', () => {
		expect(requiredError('Ondra', 'Vyplňte jméno.')).toBeUndefined()
	})

	it('samotné mezery za vyplnění nepovažuje', () => {
		expect(requiredError('  ', 'Vyplňte jméno.')).toBe('Vyplňte jméno.')
	})
})
