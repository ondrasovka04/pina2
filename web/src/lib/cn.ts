/**
 * Skládání tříd. Záměrně bez knihovny — jediné, co potřebujeme, je vyhodit
 * `false`/`undefined` z podmíněných větví.
 */
export function cn(...values: Array<string | false | null | undefined>): string {
	return values.filter((value) => typeof value === 'string' && value !== '').join(' ')
}
