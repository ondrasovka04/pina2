import type { SubmitEvent } from 'react'
import { useMemo, useState } from 'react'

import { useTeam } from '@/app/team'
import { Button } from '@/components/ui/Button'
import { Card, CardHeader } from '@/components/ui/Card'
import { ConfirmDialog } from '@/components/ui/ConfirmDialog'
import { Field } from '@/components/ui/Field'
import { PlusIcon } from '@/components/ui/icons'
import { Money } from '@/components/ui/Money'
import { ReorderableList } from '@/components/ui/ReorderableList'
import { EmptyState, ErrorState, LoadingState } from '@/components/ui/States'
import { ApiError } from '@/lib/api'
import {
	useArchivedOffenceTypes,
	useArchiveOffenceType,
	useCreateOffenceType,
	useOffenceTypes,
	useReorderOffenceTypes,
	useUpdateOffenceType,
} from '@/lib/queries'
import type { OffenceCategory, OffenceType } from '@/lib/types'
import { categoryLabels, isBonus, offenceCategories, toCategory } from '@/lib/types'

type CategoryKey = OffenceCategory | 'other'

/** „Ostatní" jde vždy na konec, ať položky bez kategorie nerozbíjí pořadí zbytku. */
const categoryOrder: CategoryKey[] = [...offenceCategories, 'other']

function categoryLabel(key: CategoryKey): string {
	return key === 'other' ? 'Ostatní' : categoryLabels[key]
}

/** Nabídka kategorií pro formuláře — prázdná hodnota znamená „bez kategorie". */
const categoryOptions: Array<{ value: OffenceCategory | ''; label: string }> = [
	{ value: '', label: 'Bez kategorie' },
	...offenceCategories.map((key) => ({ value: key, label: categoryLabels[key] })),
]

function sortTypes(items: OffenceType[]): OffenceType[] {
	return items.toSorted((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name, 'cs'))
}

const selectClassName = 'rounded-xl border border-line bg-surface-2 px-3 py-2.5 text-base text-ink'

export function OffenceTypesPage() {
	const { seasonId, can } = useTeam()
	// Sazebník spravuje pínař: je to peněžní agenda, ne správa lidí.
	const canEdit = can('treasurer')

	const { data, isPending, error, refetch } = useOffenceTypes(seasonId)
	const archived = useArchivedOffenceTypes(seasonId)
	const reorder = useReorderOffenceTypes(seasonId ?? 0)
	const [formOpen, setFormOpen] = useState(false)
	const [reordering, setReordering] = useState(false)

	// Pořadí se srovnává přes celý sazebník, ne uvnitř kategorií — `sort_order`
	// je jedno číslo na položku a dělené přetahování by z něj dělalo hádanku.
	const active = useMemo(() => sortTypes((data ?? []).filter((item) => item.archivedAt === null)), [data])

	const groups = useMemo(() => {
		const byCategory = new Map<CategoryKey, OffenceType[]>()
		for (const key of categoryOrder) byCategory.set(key, [])

		for (const item of active) {
			const key: CategoryKey = item.category ?? 'other'
			byCategory.get(key)?.push(item)
		}

		return categoryOrder
			.map((key) => ({ key, items: sortTypes(byCategory.get(key) ?? []) }))
			.filter((group) => group.items.length > 0)
	}, [active])

	if (seasonId === null) {
		return (
			<EmptyState
				title="Tým nemá rozjetou sezónu"
				description="Sezónu založí admin družstva. Bez ní není sazebník k čemu vázat."
			/>
		)
	}

	if (isPending) return <LoadingState />
	if (error !== null) return <ErrorState error={error} onRetry={() => void refetch()} />

	return (
		<div className="flex flex-col gap-4">
			<div className="flex items-center justify-between">
				<h1 className="text-lg font-semibold">Sazebník</h1>
				{canEdit ? (
					<div className="flex gap-2">
						<Button size="sm" variant="ghost" onClick={() => setReordering((value) => !value)}>
							{reordering ? 'Hotovo' : 'Změnit pořadí'}
						</Button>
						{reordering ? null : (
							<Button size="sm" variant="accent" onClick={() => setFormOpen((open) => !open)}>
								<PlusIcon className="size-4" />
								Přidat položku
							</Button>
						)}
					</div>
				) : null}
			</div>

			{canEdit && formOpen ? <CreateOffenceTypeForm seasonId={seasonId} onDone={() => setFormOpen(false)} /> : null}

			{reordering ? (
				<Card className="overflow-hidden">
					<CardHeader
						title="Pořadí v zápisu"
						subtitle="Chyť položku za úchyt vlevo a přetáhni. V tomhle pořadí se prohřešky nabízejí při zápisu."
						action={reorder.isPending ? <span className="text-ink-faint text-xs">ukládá se…</span> : undefined}
					/>
					<ReorderableList
						items={active}
						getKey={(item) => item.id}
						getLabel={(item) => item.name}
						onReorder={(items) => reorder.mutate(items.map((item) => item.id))}
						renderItem={(item) => (
							<div className="flex items-center justify-between gap-3">
								<span className="truncate text-sm font-medium">{item.name}</span>
								<Money czk={item.amountCzk} className="text-sm" />
							</div>
						)}
					/>
				</Card>
			) : groups.length === 0 ? (
				<EmptyState title="Sazebník je prázdný" description="Zatím tu není žádná položka k zapisování." />
			) : (
				groups.map((group) => (
					<Card key={group.key} className="overflow-hidden">
						<CardHeader title={categoryLabel(group.key)} />
						<div className="divide-line/50 divide-y">
							{group.items.map((item) => (
								<OffenceTypeRow key={item.id} item={item} seasonId={seasonId} canEdit={canEdit} />
							))}
						</div>
					</Card>
				))
			)}

			{archived.data !== undefined && archived.data.length > 0 ? (
				<details className="border-line/60 bg-surface-1 text-ink-faint rounded-2xl border">
					<summary className="cursor-pointer px-4 py-3 text-sm font-medium select-none">
						Archivované položky ({archived.data.length})
					</summary>
					<div className="divide-line/50 border-line/60 divide-y border-t">
						{archived.data.map((item) => (
							<div key={item.id} className="flex items-center justify-between gap-3 px-4 py-3 text-sm">
								<span className="truncate">
									{item.name}
									{isBonus(item.amountCzk) ? <span className="ml-2 text-xs">(bonus)</span> : null}
								</span>
								<Money czk={item.amountCzk} />
							</div>
						))}
					</div>
				</details>
			) : null}
		</div>
	)
}

function OffenceTypeRow({ item, seasonId, canEdit }: { item: OffenceType; seasonId: number; canEdit: boolean }) {
	const [editing, setEditing] = useState(false)
	const [confirmingArchive, setConfirmingArchive] = useState(false)
	const update = useUpdateOffenceType(seasonId)
	const archive = useArchiveOffenceType(seasonId)

	if (editing) {
		return (
			<EditOffenceTypeForm
				item={item}
				saving={update.isPending}
				error={update.error}
				onCancel={() => setEditing(false)}
				onSave={(changes) => {
					update.mutate({ id: item.id, changes }, { onSuccess: () => setEditing(false) })
				}}
			/>
		)
	}

	return (
		<div className="flex items-center justify-between gap-3 px-4 py-3">
			<div className="min-w-0 flex-1">
				<p className="truncate font-medium">{item.name}</p>
				{isBonus(item.amountCzk) ? <p className="text-bonus text-xs">bonus</p> : null}
			</div>

			<Money czk={item.amountCzk} className="font-semibold" />

			{canEdit ? (
				<div className="flex shrink-0 gap-2">
					<Button size="sm" variant="ghost" onClick={() => setEditing(true)}>
						Upravit
					</Button>
					<Button size="sm" variant="danger" loading={archive.isPending} onClick={() => setConfirmingArchive(true)}>
						Archivovat
					</Button>
				</div>
			) : null}

			<ConfirmDialog
				open={confirmingArchive}
				title={`Archivovat „${item.name}"?`}
				description="Položka zmizí ze sazebníku a už se nebude dát zapisovat. Zapsané prohřešky zůstanou i s částkou beze změny — archivace není mazání."
				confirmLabel="Archivovat"
				danger
				onConfirm={() => {
					archive.mutate(item.id)
					setConfirmingArchive(false)
				}}
				onCancel={() => setConfirmingArchive(false)}
			/>
		</div>
	)
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

function CreateOffenceTypeForm({ seasonId, onDone }: { seasonId: number; onDone: () => void }) {
	const create = useCreateOffenceType(seasonId)
	const [name, setName] = useState('')
	const [amount, setAmount] = useState('')
	const [category, setCategory] = useState<OffenceCategory | ''>('')

	function submit(event: SubmitEvent<HTMLFormElement>) {
		event.preventDefault()

		const amountCzk = Number.parseInt(amount, 10)
		if (Number.isNaN(amountCzk)) return

		create.mutate(
			{ name: name.trim(), amountCzk, category: category === '' ? null : category },
			{
				onSuccess: () => {
					setName('')
					setAmount('')
					setCategory('')
					onDone()
				},
			},
		)
	}

	return (
		<Card className="p-4">
			<form onSubmit={submit} className="flex flex-col gap-3">
				<Field
					label="Název"
					value={name}
					onChange={(event) => setName(event.target.value)}
					maxLength={120}
					required
					error={fieldMessage(create.error, 'name')}
				/>
				<Field
					label="Částka v Kč"
					type="number"
					step={1}
					value={amount}
					onChange={(event) => setAmount(event.target.value)}
					required
					hint="Záporná částka je bonus, který dluh snižuje."
					error={fieldMessage(create.error, 'amountCzk')}
				/>
				<label className="flex flex-col gap-1.5">
					<span className="text-ink-muted text-sm font-medium">Kategorie</span>
					<select
						value={category}
						onChange={(event) => setCategory(toCategory(event.target.value))}
						className={selectClassName}
					>
						{categoryOptions.map((option) => (
							<option key={option.value} value={option.value}>
								{option.label}
							</option>
						))}
					</select>
				</label>

				{generalMessage(create.error) === undefined ? null : (
					<p role="alert" className="text-debt text-sm">
						{generalMessage(create.error)}
					</p>
				)}

				<div className="flex justify-end gap-2">
					<Button type="button" variant="ghost" onClick={onDone}>
						Zrušit
					</Button>
					<Button type="submit" loading={create.isPending}>
						Uložit
					</Button>
				</div>
			</form>
		</Card>
	)
}

interface EditOffenceTypeFormProps {
	item: OffenceType
	saving: boolean
	error: unknown
	onCancel: () => void
	onSave: (changes: { name: string; amountCzk: number; category: OffenceCategory | null }) => void
}

function EditOffenceTypeForm({ item, saving, error, onCancel, onSave }: EditOffenceTypeFormProps) {
	const [name, setName] = useState(item.name)
	const [amount, setAmount] = useState(String(item.amountCzk))
	const [category, setCategory] = useState<OffenceCategory | ''>(item.category ?? '')

	function submit(event: SubmitEvent<HTMLFormElement>) {
		event.preventDefault()

		const amountCzk = Number.parseInt(amount, 10)
		if (Number.isNaN(amountCzk)) return

		onSave({ name: name.trim(), amountCzk, category: category === '' ? null : category })
	}

	return (
		<div className="bg-surface-2/60 px-4 py-4">
			<form onSubmit={submit} className="flex flex-col gap-3">
				<Field
					label="Název"
					value={name}
					onChange={(event) => setName(event.target.value)}
					maxLength={120}
					required
					error={fieldMessage(error, 'name')}
				/>
				<Field
					label="Částka v Kč"
					type="number"
					step={1}
					value={amount}
					onChange={(event) => setAmount(event.target.value)}
					required
					hint="Nová cena platí jen pro nové zápisy — už zapsané prohřešky si drží cenu z doby zápisu."
					error={fieldMessage(error, 'amountCzk')}
				/>
				<label className="flex flex-col gap-1.5">
					<span className="text-ink-muted text-sm font-medium">Kategorie</span>
					<select
						value={category}
						onChange={(event) => setCategory(toCategory(event.target.value))}
						className={selectClassName}
					>
						{categoryOptions.map((option) => (
							<option key={option.value} value={option.value}>
								{option.label}
							</option>
						))}
					</select>
				</label>

				{generalMessage(error) === undefined ? null : (
					<p role="alert" className="text-debt text-sm">
						{generalMessage(error)}
					</p>
				)}

				<div className="flex justify-end gap-2">
					<Button type="button" variant="ghost" onClick={onCancel}>
						Zrušit
					</Button>
					<Button type="submit" loading={saving}>
						Uložit
					</Button>
				</div>
			</form>
		</div>
	)
}
