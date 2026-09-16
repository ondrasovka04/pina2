export function plural(count: number, one: string, few: string, many: string): string {
	if (count === 1) {
		return `${count} ${one}`
	}
	if (count >= 2 && count <= 4) {
		return `${count} ${few}`
	}

	return `${count} ${many}`
}

export function records(count: number): string {
	return count === 0 ? 'bez zápisu' : plural(count, 'zápis', 'zápisy', 'zápisů')
}

export function players(count: number): string {
	return plural(count, 'hráč', 'hráči', 'hráčů')
}
