/**
 * Světlý a tmavý režim.
 *
 * Vybraný motiv se ukládá do localStorage a stejnou hodnotu čte i krátký skript
 * v `index.html`, který nastaví `data-theme` ještě před prvním vykreslením —
 * jinak by při každém načtení bliklo světlé pozadí. Klíč i logika se proto musí
 * držet ve shodě s ním.
 */
export type ThemePreference = 'system' | 'light' | 'dark'
export type ResolvedTheme = 'light' | 'dark'

export const STORAGE_KEY = 'pina.theme'

/** Musí odpovídat `--color-surface-0` v obou režimech, aby lišta prohlížeče navazovala. */
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
		// Privátní režim v Safari umí localStorage zakázat; motiv pak jen nepřežije reload.
		return 'system'
	}
}

export function prefersDark(): boolean {
	return window.matchMedia('(prefers-color-scheme: dark)').matches
}

export function resolveTheme(preference: ThemePreference): ResolvedTheme {
	if (preference !== 'system') return preference

	return prefersDark() ? 'dark' : 'light'
}

/** Zapíše motiv do DOM. Barvu lišty prohlížeče je nutné přepsat ručně — meta tag se sám neaktualizuje. */
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
		// Neuložilo se — volba platí do konce relace.
	}
}
