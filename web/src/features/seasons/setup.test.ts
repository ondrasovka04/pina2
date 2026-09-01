import type { TeamSettings } from '@/lib/types'

import { missingTeamSetup } from './setup'

function settings(changes: Partial<TeamSettings> = {}): TeamSettings {
	return {
		travelEnabled: false,
		travelRateCzkKm: 5,
		travelRoundTrip: true,
		homeLocationId: null,
		attendanceVisibleToPlayers: true,
		balancesVisibleToPlayers: true,
		rsvpDeadlineTrainingHours: 24,
		rsvpDeadlineMatchHours: 48,
		bankAccount: '123456789/0800',
		...changes,
	}
}

describe('missingTeamSetup', () => {
	it('u hotového nastavení nemá co připomínat', () => {
		expect(missingTeamSetup(settings())).toEqual([])
	})

	/** Bez účtu se to dnes pozná až tím, že hráči místo QR svítí hláška. */
	it('připomene chybějící číslo účtu', () => {
		expect(missingTeamSetup(settings({ bankAccount: null }))).toEqual([expect.stringContaining('Číslo účtu')])
	})

	it('domácí halu připomene jen tam, kde se cesťáky proplácejí', () => {
		expect(missingTeamSetup(settings({ travelEnabled: false }))).toEqual([])
		expect(missingTeamSetup(settings({ travelEnabled: true }))).toEqual([expect.stringContaining('Domácí halu')])
	})

	it('vypíše obojí, když chybí obojí', () => {
		expect(missingTeamSetup(settings({ bankAccount: null, travelEnabled: true }))).toHaveLength(2)
	})
})
