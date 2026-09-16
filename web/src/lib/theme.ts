// Motiv v localStorage — klíč a logika se drží se shodou s index.html skriptem
export type ThemePreference = 'system' | 'light' | 'dark'
export type ResolvedTheme = 'light' | 'dark'

export const STORAGE_KEY = 'pina.theme'

const themeColors: Record<ResolvedTheme, string> = {
	light: '#f3f5f9',
	dark: '#090d16',
}

export const themeLabels: Record<ThemePreference, string> = {
	system: 'Podle systému',
	light: 'Světlý',
	dark: 'Tmavý',
}

function isPreference(value: unknown): value is ThemePreference {
	return value === 'system' || value === 'light' || value === 'dark'
}

export function readPreference(): ThemePreference {
	try {
		const stored = localStorage.getItem(STORAGE_KEY)

		return isPreference(stored) ? stored : 'system'
	} catch {
		return 'system'
	}
}

export function prefersDark(): boolean {
	return window.matchMedia('(prefers-color-scheme: dark)').matches
}

export function resolveTheme(preference: ThemePreference): ResolvedTheme {
	if (preference !== 'system') {
		return preference
	}

	return prefersDark() ? 'dark' : 'light'
}

export function applyTheme(preference: ThemePreference): ResolvedTheme {
	const resolved = resolveTheme(preference)

	document.documentElement.dataset['theme'] = resolved
	document.querySelector('meta[name="theme-color"]')?.setAttribute('content', themeColors[resolved])

	return resolved
}

export function savePreference(preference: ThemePreference): void {
	try {
		localStorage.setItem(STORAGE_KEY, preference)
	} catch {
		// Neuložilo se — volba zůstane do konce relace
	}
}
