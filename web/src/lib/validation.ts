// Validace formulářů na klientovi — nativní by mluv jazykem systému

// Záměrně volné — jen zřejmé chyby (zavináč, mezera, tečka v doméně)
const EMAIL_SHAPE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/

export function emailError(value: string): string | undefined {
	const email = value.trim()

	if (email === '') {
		return 'Vyplňte e-mail.'
	}
	if (!EMAIL_SHAPE.test(email)) {
		return 'E-mail nemá platný tvar. Zkontrolujte zavináč a doménu, třeba „jan@seznam.cz".'
	}

	return undefined
}

export function requiredError(value: string, message: string): string | undefined {
	return value.trim() === '' ? message : undefined
}

// [předčíslí-]číslo/kód banky; kód banky je vždy čtyřmístný
const CZECH_ACCOUNT_SHAPE = /^(\d{1,6}-)?\d{2,10}\/\d{4}$/
// dvě písmena země, dvě kontrolní číslice, pak alfanumerika
const IBAN_SHAPE = /^[A-Z]{2}\d{2}[A-Z0-9]{11,30}$/i

/**
 * Jen tvar, ne platnost — kontrolní číslice si spočítá server. Slouží k tomu,
 * aby se rozepsané číslo účtu neposílalo po každé klávese a nesvítila chyba nad
 * polovinou účtu.
 */
export function looksLikeBankAccount(value: string): boolean {
	const account = value.replaceAll(' ', '')

	return CZECH_ACCOUNT_SHAPE.test(account) || IBAN_SHAPE.test(account)
}
