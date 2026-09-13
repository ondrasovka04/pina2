import { plural } from '@/lib/plural'
import type { AuditEntry, Role } from '@/lib/types'
import { formatCzk, formatDate, roleLabels } from '@/lib/types'

function numberValue(entry: AuditEntry, key: string): number | null {
	const value = entry.payload[key]

	return typeof value === 'number' ? value : null
}

function stringValue(entry: AuditEntry, key: string): string | null {
	const value = entry.payload[key]

	return typeof value === 'string' ? value : null
}

function changedValue(entry: AuditEntry, key: string, side: 'old' | 'new'): unknown {
	const value = entry.payload[key]

	return typeof value === 'object' && value !== null ? Reflect.get(value, side) : undefined
}

function member(entry: AuditEntry): string {
	return entry.membershipName ?? `člen #${numberValue(entry, 'membershipId') ?? entry.entityId ?? '?'}`
}

function role(value: string | null): string {
	return value !== null && value in roleLabels ? roleLabels[value as Role] : (value ?? 'neznámá role')
}

function optionalAccount(value: unknown): string {
	return typeof value === 'string' && value !== '' ? value : 'bez účtu'
}

function formatRate(value: number): string {
	return `${new Intl.NumberFormat('cs-CZ', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(value)} Kč`
}

export function describeAuditEntry(entry: AuditEntry): string {
	if (entry.action === 'voided' && entry.entity === 'payment') {
		const amount = numberValue(entry, 'amountCzk')
		const reason = stringValue(entry, 'reason')

		return `Stornoval platbu${amount === null ? '' : ` ${formatCzk(amount)}`}: ${member(entry)}${reason === null ? '.' : `. Důvod: ${reason}.`}`
	}

	if (entry.action === 'voided' && entry.entity === 'travel_claim') {
		const amount = numberValue(entry, 'amountCzk')
		const event = entry.eventTitle === null ? '' : ` za akci ${entry.eventTitle}`

		return `Stornoval cesťák${amount === null ? '' : ` ${formatCzk(amount)}`}: ${member(entry)}${event}.`
	}

	if (entry.action === 'voided' && entry.entity === 'offence_batch') {
		const count = numberValue(entry, 'recordCount')
		const total = numberValue(entry, 'totalCzk')

		return `Stornoval dávku${count === null ? '' : ` s ${plural(count, 'zápisem', 'zápisy', 'zápisy')}`}${total === null ? '' : ` za ${formatCzk(total)}`}.`
	}

	if (entry.action === 'voided' && entry.entity === 'offence_record') {
		const amount = numberValue(entry, 'amountCzk')
		const type = entry.offenceTypeName ?? 'prohřešek'

		return `Stornoval zápis „${type}“${amount === null ? '' : ` za ${formatCzk(amount)}`}: ${member(entry)}.`
	}

	if (entry.action === 'price_changed' && entry.entity === 'offence_type') {
		const oldAmount = numberValue(entry, 'oldAmountCzk')
		const newAmount = numberValue(entry, 'newAmountCzk')
		const type = entry.offenceTypeName ?? 'položky sazebníku'

		return `Změnil cenu „${type}“ z ${oldAmount === null ? '?' : formatCzk(oldAmount)} na ${newAmount === null ? '?' : formatCzk(newAmount)}.`
	}

	if (entry.action === 'settings_changed' && entry.entity === 'team_settings') {
		const parts: string[] = []
		const oldAccount = changedValue(entry, 'bankAccount', 'old')
		const newAccount = changedValue(entry, 'bankAccount', 'new')
		if (oldAccount !== undefined || newAccount !== undefined) {
			parts.push(`účet: ${optionalAccount(oldAccount)} → ${optionalAccount(newAccount)}`)
		}

		const oldRate = changedValue(entry, 'travelRateCzkKm', 'old')
		const newRate = changedValue(entry, 'travelRateCzkKm', 'new')
		if (typeof oldRate === 'number' && typeof newRate === 'number') {
			parts.push(`sazbu cesťáků: ${formatRate(oldRate)}/km → ${formatRate(newRate)}/km`)
		}

		return `Změnil ${parts.length === 0 ? 'nastavení družstva' : parts.join(' a ')}.`
	}

	if (entry.action === 'role_changed' && entry.entity === 'membership') {
		return `Změnil roli: ${member(entry)}, ${role(stringValue(entry, 'oldRole'))} → ${role(stringValue(entry, 'newRole'))}.`
	}

	if (entry.action === 'email_changed' && entry.entity === 'membership') {
		return `Změnil e-mail: ${member(entry)}.`
	}

	if (entry.action === 'status_changed' && entry.entity === 'membership') {
		return stringValue(entry, 'newStatus') === 'left'
			? `Ukončil členství: ${member(entry)}.`
			: `Obnovil členství: ${member(entry)}.`
	}

	if (entry.action === 'activation_link_issued' && entry.entity === 'invitation') {
		return `Vydal aktivační odkaz: ${member(entry)}.`
	}

	if (entry.action === 'half_year_changed' && entry.entity === 'season') {
		const oldDate = stringValue(entry, 'oldHalfYearOn')
		const newDate = stringValue(entry, 'newHalfYearOn')
		const season = entry.seasonName ?? `sezóny #${entry.entityId ?? '?'}`

		return `Přelom pololetí ${season}: ${oldDate === null ? 'bez přelomu' : formatDate(oldDate)} → ${newDate === null ? 'bez přelomu' : formatDate(newDate)}.`
	}

	if (entry.action === 'closed' && entry.entity === 'season') {
		return `Uzavřel sezónu ${entry.seasonName ?? `#${entry.entityId ?? '?'}`}.`
	}

	return `Provedl akci ${entry.action} nad ${entry.entity}${entry.entityId === null ? '' : ` #${entry.entityId}`}.`
}
