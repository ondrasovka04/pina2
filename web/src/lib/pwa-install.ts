export interface InstallPromptEvent extends Event {
	prompt: () => Promise<void>
	userChoice: Promise<{ outcome: 'accepted' | 'dismissed'; platform: string }>
}

let promptEvent: InstallPromptEvent | null = null
const listeners = new Set<() => void>()

if (typeof window !== 'undefined') {
	window.addEventListener('beforeinstallprompt', (event) => {
		event.preventDefault()
		promptEvent = event as InstallPromptEvent
		listeners.forEach((listener) => listener())
	})

	window.addEventListener('appinstalled', () => {
		promptEvent = null
		listeners.forEach((listener) => listener())
	})
}

export function subscribeToInstallPrompt(listener: () => void): () => void {
	listeners.add(listener)

	return () => listeners.delete(listener)
}

export function getInstallPrompt(): InstallPromptEvent | null {
	return promptEvent
}

export function clearInstallPrompt(): void {
	promptEvent = null
	listeners.forEach((listener) => listener())
}
