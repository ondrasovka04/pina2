/**
 * Dotykové zařízení, ne konkrétní systém.
 *
 * Podle `navigator.userAgent` to poznat nejde: iPadOS se v Safari hlásí jako
 * macOS, takže by iPad vyšel jako počítač — a právě na iPadu je instalace
 * k oznámením povinná. `any-pointer` schválně místo `pointer`: myš vedle dotyku
 * (iPad s trackpadem) instalaci nevylučuje, a radši ji nabídnout i dotykovému
 * notebooku než ji sebrat iPadu.
 */
export function isHandheld(): boolean {
	return navigator.maxTouchPoints > 0 && window.matchMedia('(any-pointer: coarse)').matches
}

/** Aplikace spuštěná z plochy, ne v kartě prohlížeče. */
export function isStandalone(): boolean {
	return window.matchMedia('(display-mode: standalone)').matches
}
