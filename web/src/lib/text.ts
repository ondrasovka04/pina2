/** Porovnávací tvar bez diakritiky a velikosti písmen — „srsen" pak najde i „Šršeň". */
export function normalize(value: string): string {
	return value
		.trim()
		.toLocaleLowerCase('cs-CZ')
		.normalize('NFD')
		.replace(/\p{Diacritic}/gu, '')
}

/** Prázdný dotaz projde vždy, aby se hledání nemuselo ošetřovat na každém místě. */
export function matches(haystack: string, needle: string): boolean {
	const query = normalize(needle)

	return query === '' || normalize(haystack).includes(query)
}
