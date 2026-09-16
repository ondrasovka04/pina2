import { useCallback, useEffect, useState } from 'react'

import type { ThemePreference } from '@/lib/theme'
import { applyTheme, readPreference, savePreference } from '@/lib/theme'

interface ThemeControl {
	preference: ThemePreference
	setPreference: (next: ThemePreference) => void
}

// Přepínání motivu — reakce na systémovou volbu za běhu
export function useTheme(): ThemeControl {
	const [preference, setStored] = useState<ThemePreference>(readPreference)

	useEffect(() => {
		applyTheme(preference)

		if (preference !== 'system') {
			return
		}

		const media = window.matchMedia('(prefers-color-scheme: dark)')
		const onChange = () => applyTheme('system')

		media.addEventListener('change', onChange)

		return () => media.removeEventListener('change', onChange)
	}, [preference])

	const setPreference = useCallback((next: ThemePreference) => {
		savePreference(next)
		setStored(next)
	}, [])

	return { preference, setPreference }
}
