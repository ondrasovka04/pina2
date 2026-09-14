/** Server ukládá česká čísla jednotně včetně +420. */
export function formatPhone(phone: string): string {
	return phone.replace(/^(\+420)(\d{3})(\d{3})(\d{3})$/, '$1 $2 $3 $4')
}
