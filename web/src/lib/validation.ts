// Validace formulářů na klientovi — nativní by mluv jazykem systému

// Záměrně volné — jen zřejmé chyby (zavináč, mezera, tečka v doméně)
const EMAIL_SHAPE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/

export function emailError(value: string): string | undefined {
	const email = value.trim()

	if (email === '') return 'Vyplňte e-mail.'
	if (!EMAIL_SHAPE.test(email)) return 'E-mail nemá platný tvar. Zkontrolujte zavináč a doménu, třeba „jan@seznam.cz".'

	return undefined
}

export function requiredError(value: string, message: string): string | undefined {
	return value.trim() === '' ? message : undefined
}
