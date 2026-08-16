import type { SubmitEvent } from 'react'
import { useState } from 'react'
import { Link } from 'react-router'

import { useTeam } from '@/app/team'
import { Button } from '@/components/ui/Button'
import { Card } from '@/components/ui/Card'
import { ConfirmDialog } from '@/components/ui/ConfirmDialog'
import { Field } from '@/components/ui/Field'
import { ArrowLeftIcon, PlusIcon } from '@/components/ui/icons'
import { EmptyState, ErrorState, LoadingState } from '@/components/ui/States'
import { navigationUrl } from '@/features/events/events'
import { ApiError } from '@/lib/api'
import { plural } from '@/lib/plural'
import type { LocationInput } from '@/lib/queries'
import { useCreateLocation, useDeleteLocation, useLocations, useUpdateLocation } from '@/lib/queries'
import type { ClubLocation } from '@/lib/types'

function sortLocations(items: ClubLocation[]): ClubLocation[] {
	return items.toSorted((a, b) => a.name.localeCompare(b.name, 'cs'))
}

/** Vytáhne hlášku pro konkrétní pole formuláře, pokud ji server takhle označil. */
function fieldMessage(error: unknown, field: string): string | undefined {
	return error instanceof ApiError && error.field === field ? error.message : undefined
}

/** Obecná hláška — chyba z API bez konkrétního pole, nebo síťová chyba. */
function generalMessage(error: unknown): string | undefined {
	if (error === null || error === undefined) return undefined
	if (error instanceof ApiError) return error.field === undefined ? error.message : undefined

	return 'Něco se pokazilo. Zkuste to prosím znovu.'
}

function usageLabel(count: number): string {
	return count === 0 ? 'Zatím nepoužité' : `Používá ho ${plural(count, 'akce', 'akce', 'akcí')}`
}

/** Místa se sdílí mezi družstvy klubu, proto je zakládá a upravuje jen admin. */
export function LocationsPage() {
	const { team, can } = useTeam()
	const isAdmin = can('admin')
	const clubId = team?.clubId ?? null

	const locations = useLocations(clubId)
	const [formOpen, setFormOpen] = useState(false)

	if (!isAdmin || team === null) {
		return (
			<EmptyState
				title="Místa spravuje admin"
				description="Haly a hřiště sdílí všechna družstva klubu, proto je zakládá a upravuje admin. Pro přístup ho poproste."
			/>
		)
	}

	if (locations.isPending) return <LoadingState />
	if (locations.error !== null) return <ErrorState error={locations.error} onRetry={() => void locations.refetch()} />

	const items = sortLocations(locations.data ?? [])

	return (
		<div className="flex flex-col gap-4">
			<BackLink />

			<div className="flex flex-wrap items-start justify-between gap-3">
				<div>
					<h1 className="text-lg font-semibold">Místa</h1>
					<p className="text-ink-muted text-sm">
						{team.clubName} — místa sdílí všechna družstva klubu, halu na Proseku tak nezakládá každé zvlášť.
					</p>
				</div>
				{formOpen ? null : (
					<Button size="sm" variant="accent" onClick={() => setFormOpen(true)}>
						<PlusIcon className="size-4" />
						Nové místo
					</Button>
				)}
			</div>

			{formOpen ? (
				<Card className="p-4">
					<h2 className="font-semibold">Nové místo</h2>
					<div className="mt-3">
						<LocationForm
							clubId={team.clubId}
							cancelLabel="Zrušit"
							onDone={() => setFormOpen(false)}
							onCancel={() => setFormOpen(false)}
						/>
					</div>
				</Card>
			) : null}

			{items.length === 0 ? (
				<EmptyState title="Zatím žádná místa" description="Přidejte první halu nebo hřiště tlačítkem nahoře." />
			) : (
				<Card className="overflow-hidden">
					<div className="divide-line/50 divide-y">
						{items.map((location) => (
							<LocationRow key={location.id} location={location} clubId={team.clubId} />
						))}
					</div>
				</Card>
			)}
		</div>
	)
}

function BackLink() {
	return (
		<Link to="/kalendar" className="text-ink-muted hover:text-ink inline-flex items-center gap-1.5 text-sm">
			<ArrowLeftIcon className="size-4" />
			Zpět na kalendář
		</Link>
	)
}

function LocationRow({ location, clubId }: { location: ClubLocation; clubId: number }) {
	const [editing, setEditing] = useState(false)
	const [confirmingDelete, setConfirmingDelete] = useState(false)
	const [deleteError, setDeleteError] = useState<string | null>(null)
	const remove = useDeleteLocation(clubId)

	const url = navigationUrl(location)
	const inUse = location.usedByEvents > 0

	return (
		<div className="border-line/50 border-b last:border-b-0">
			<div className="flex items-center gap-2 px-4 py-3">
				<button
					type="button"
					onClick={() => setEditing((value) => !value)}
					aria-expanded={editing}
					className="min-w-0 flex-1 text-left"
				>
					<p className="truncate font-medium">{location.name}</p>
					{location.address === null ? null : <p className="text-ink-muted truncate text-sm">{location.address}</p>}
					{location.note === null ? null : <p className="text-ink-faint truncate text-xs">{location.note}</p>}
					<p className="text-ink-faint mt-0.5 text-xs">{usageLabel(location.usedByEvents)}</p>
				</button>

				<div className="flex shrink-0 flex-col items-end gap-1.5">
					{url === null ? null : (
						<a
							href={url}
							target="_blank"
							rel="noreferrer"
							className="text-brand-600 text-sm underline-offset-2 hover:underline"
						>
							Navigovat
						</a>
					)}
					{inUse ? (
						<span className="text-ink-faint text-xs">Používané, nejde smazat</span>
					) : (
						<Button size="sm" variant="danger" onClick={() => setConfirmingDelete(true)}>
							Smazat
						</Button>
					)}
				</div>
			</div>

			{editing ? (
				<div className="bg-surface-2/60 px-4 py-4">
					<LocationForm
						clubId={clubId}
						initial={location}
						cancelLabel="Zpět"
						onDone={() => setEditing(false)}
						onCancel={() => setEditing(false)}
					/>
				</div>
			) : null}

			{deleteError === null ? null : (
				<p role="alert" className="text-debt px-4 pb-3 text-sm">
					{deleteError}
				</p>
			)}

			<ConfirmDialog
				open={confirmingDelete}
				title={`Smazat „${location.name}"?`}
				description="Místo zmizí ze seznamu i z nabídky při zakládání akcí. Historie akcí, kde se používalo, zůstane beze změny."
				confirmLabel="Smazat"
				danger
				onConfirm={() => {
					setConfirmingDelete(false)
					setDeleteError(null)
					remove.mutate(location.id, {
						onError: (cause) => {
							setDeleteError(cause instanceof ApiError ? cause.message : 'Místo se nepodařilo smazat.')
						},
					})
				}}
				onCancel={() => setConfirmingDelete(false)}
			/>
		</div>
	)
}

interface LocationDraft {
	name: string
	address: string
	lat: string
	lng: string
	note: string
}

function draftFrom(location?: ClubLocation): LocationDraft {
	return {
		name: location?.name ?? '',
		address: location?.address ?? '',
		lat: location?.lat === null || location?.lat === undefined ? '' : String(location.lat),
		lng: location?.lng === null || location?.lng === undefined ? '' : String(location.lng),
		note: location?.note ?? '',
	}
}

// Prázdné pole je `null`, ne prázdný řetězec — server by jinak bral mezeru jako hodnotu.
function toInput(draft: LocationDraft): LocationInput {
	const address = draft.address.trim()
	const note = draft.note.trim()
	const lat = draft.lat.trim()
	const lng = draft.lng.trim()

	return {
		name: draft.name.trim(),
		address: address === '' ? null : address,
		note: note === '' ? null : note,
		lat: lat === '' ? null : Number(lat),
		lng: lng === '' ? null : Number(lng),
	}
}

interface LocationFormProps {
	clubId: number
	/** Bez `initial` jde o založení nového místa. */
	initial?: ClubLocation
	cancelLabel: string
	onDone: () => void
	onCancel: () => void
}

function LocationForm({ clubId, initial, cancelLabel, onDone, onCancel }: LocationFormProps) {
	const create = useCreateLocation(clubId)
	const update = useUpdateLocation(clubId)
	const [draft, setDraft] = useState<LocationDraft>(() => draftFrom(initial))

	const pending = initial === undefined ? create.isPending : update.isPending
	const error = initial === undefined ? create.error : update.error

	function submit(event: SubmitEvent<HTMLFormElement>) {
		event.preventDefault()

		const input = toInput(draft)

		if (initial === undefined) {
			create.mutate(input, { onSuccess: onDone })
		} else {
			update.mutate({ id: initial.id, changes: input }, { onSuccess: onDone })
		}
	}

	return (
		<form onSubmit={submit} className="flex flex-col gap-3">
			<Field
				label="Název"
				value={draft.name}
				onChange={(event) => setDraft((current) => ({ ...current, name: event.target.value }))}
				required
				error={fieldMessage(error, 'name')}
			/>
			<Field
				label="Adresa"
				value={draft.address}
				onChange={(event) => setDraft((current) => ({ ...current, address: event.target.value }))}
				placeholder="Nepovinné"
				error={fieldMessage(error, 'address')}
			/>
			<div className="grid grid-cols-2 gap-3">
				<Field
					label="Zeměpisná šířka"
					type="number"
					step="any"
					value={draft.lat}
					onChange={(event) => setDraft((current) => ({ ...current, lat: event.target.value }))}
					placeholder="Nepovinné"
					error={fieldMessage(error, 'lat')}
				/>
				<Field
					label="Zeměpisná délka"
					type="number"
					step="any"
					value={draft.lng}
					onChange={(event) => setDraft((current) => ({ ...current, lng: event.target.value }))}
					placeholder="Nepovinné"
					error={fieldMessage(error, 'lng')}
				/>
			</div>
			<p className="text-ink-faint -mt-1.5 text-xs">Souřadnice se zadávají obě, nebo žádná — jen adresa taky stačí.</p>

			<Field
				label="Poznámka k místu"
				value={draft.note}
				onChange={(event) => setDraft((current) => ({ ...current, note: event.target.value }))}
				placeholder="např. vchod ze dvora, šatna 3"
				error={fieldMessage(error, 'note')}
			/>

			{generalMessage(error) === undefined ? null : (
				<p role="alert" className="text-debt text-sm">
					{generalMessage(error)}
				</p>
			)}

			<div className="flex justify-end gap-2">
				<Button type="button" variant="ghost" onClick={onCancel}>
					{cancelLabel}
				</Button>
				<Button type="submit" loading={pending}>
					Uložit
				</Button>
			</div>
		</form>
	)
}
