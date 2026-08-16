// Skládání tříd — filtruje false/undefined
export function cn(...values: Array<string | false | null | undefined>): string {
	return values.filter((value) => typeof value === 'string' && value !== '').join(' ')
}
