import { useEffect, useRef } from 'react'

/**
 * Vyjede nahoru, když se uvnitř stránky přepne krok.
 *
 * `ScrollRestoration` z routeru řeší jen změnu adresy. Průvodce a dávkový zápis
 * ale mění celou obrazovku beze změny cesty, takže by se souhrn otevřel někde
 * v půlce — přesně tam, kde člověk skončil s klikáním.
 *
 * Při prvním vykreslení nedělá nic, aby nepřebíjel obnovenou pozici posuvníku
 * po návratu tlačítkem zpět.
 */
export function useScrollTopOnChange(key: unknown): void {
	const previous = useRef(key)

	useEffect(() => {
		if (previous.current === key) return

		previous.current = key
		window.scrollTo({ top: 0 })
	}, [key])
}
