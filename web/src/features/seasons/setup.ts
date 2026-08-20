import type { TeamSettings } from '@/lib/types'

/**
 * Co po založení sezóny zbývá nastavit u družstva.
 *
 * Průvodce zvládne období, sazebník i soupisku, ale zbytek leží v nastavení
 * družstva — a admin se o tom nedozví. Bez účtu se to pozná až tím, že hráči
 * místo QR svítí hláška, kterou nemá jak spravit; informace tedy dnes chodí
 * opačným směrem, než má.
 *
 * Volitelné věci (znak, viditelnost) tu schválně nejsou. Seznam, který se
 * ozývá kvůli kosmetice, se přestane čítat.
 */
export function missingTeamSetup(settings: TeamSettings): string[] {
	const missing: string[] = []

	if (settings.bankAccount === null) {
		missing.push('Číslo účtu — bez něj se hráčům u dluhu nenabídne QR platba.')
	}

	// Domácí hala rozhoduje, co je domácí zápas. Když se cesťáky neproplácejí,
	// nemá to na nic vliv a připomínat to je otravné.
	if (settings.travelEnabled && settings.homeLocationId === null) {
		missing.push('Domácí halu — bez ní se u domácího zápasu bude ptát na odvozy.')
	}

	return missing
}
