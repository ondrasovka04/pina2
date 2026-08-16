export function normalize(value: string): string {
	return value
		.trim()
		.toLocaleLowerCase('cs-CZ')
		.normalize('NFD')
		.replace(/\p{Diacritic}/gu, '')
}

export function matches(haystack: string, needle: string): boolean {
	const query = normalize(needle)

	return query === '' || normalize(haystack).includes(query)
}
