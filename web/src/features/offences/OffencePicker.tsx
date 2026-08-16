import { useMemo, useState } from 'react'

import { SearchIcon } from '@/components/ui/icons'
import { Money } from '@/components/ui/Money'
import { cn } from '@/lib/cn'
import { matches } from '@/lib/text'
import type { OffenceType } from '@/lib/types'

interface OffencePickerProps {
	types: OffenceType[]
	countOf: (offenceTypeId: number) => number
	onAdd: (offenceTypeId: number) => void
	onRemove: (offenceTypeId: number) => void
}

// Bonusy v sbalené sekci — nahoře obvyklé prohřešky po každém tréninku
export function OffencePicker({ types, countOf, onAdd, onRemove }: OffencePickerProps) {
	const [search, setSearch] = useState('')

	const { regular, bonuses } = useMemo(() => {
		const found = types.filter((type) => matches(type.name, search))

		return {
			regular: found.filter((type) => type.amountCzk >= 0),
			bonuses: found.filter((type) => type.amountCzk < 0),
		}
	}, [types, search])

	return (
		<div className="flex flex-col gap-3">
			{types.length > 12 ? (
				<div className="relative">
					<SearchIcon className="text-ink-faint absolute top-1/2 left-2 size-4 -translate-y-1/2" />
					<input
						type="search"
						value={search}
						onChange={(event) => setSearch(event.target.value)}
						placeholder="Hledat prohřešek"
						aria-label="Hledat prohřešek"
						className="border-line bg-surface-1 placeholder:text-ink-faint w-full rounded-lg border py-1.5 pr-2 pl-8 text-sm"
					/>
				</div>
			) : null}

			{regular.length === 0 && bonuses.length === 0 ? (
				<p className="text-ink-faint py-2 text-sm">Nic takového v sazebníku není.</p>
			) : null}

			{/* Výška omezena — pínař musí vidět zbytek kabiny. Strop v rem a dvh. */}
			<div className="flex max-h-[min(20rem,42dvh)] flex-wrap gap-2 overflow-y-auto overscroll-contain">
				{regular.map((type) => (
					<OffenceChip
						key={type.id}
						type={type}
						count={countOf(type.id)}
						onAdd={() => onAdd(type.id)}
						onRemove={() => onRemove(type.id)}
					/>
				))}
			</div>

			{bonuses.length > 0 ? (
				<details open={search !== ''} className="border-line/60 rounded-xl border">
					<summary className="text-ink-muted cursor-pointer px-3 py-2 text-sm font-medium select-none">
						Bonusy a cesťáky ({bonuses.length})
					</summary>
					<div className="flex max-h-[min(16rem,35dvh)] flex-wrap gap-2 overflow-y-auto overscroll-contain px-3 pt-1 pb-3">
						{bonuses.map((type) => (
							<OffenceChip
								key={type.id}
								type={type}
								count={countOf(type.id)}
								onAdd={() => onAdd(type.id)}
								onRemove={() => onRemove(type.id)}
							/>
						))}
					</div>
				</details>
			) : null}
		</div>
	)
}

interface OffenceChipProps {
	type: OffenceType
	count: number
	onAdd: () => void
	onRemove: () => void
}

// Ťuknutí přidá, křížek se vybere jen když je co ubrat
function OffenceChip({ type, count, onAdd, onRemove }: OffenceChipProps) {
	const picked = count > 0

	return (
		<span
			className={cn(
				'flex items-stretch overflow-hidden rounded-xl border transition-colors',
				picked ? 'border-accent bg-accent/10' : 'border-line bg-surface-1',
			)}
		>
			<button type="button" onClick={onAdd} className="flex min-h-11 items-center gap-2 px-3 text-sm">
				<span className={picked ? 'text-ink' : 'text-ink-muted'}>{type.name}</span>
				<Money czk={type.amountCzk} className="text-xs" />
				{picked ? (
					<span className="tabular bg-accent text-on-accent grid size-5 place-items-center rounded-full text-xs font-semibold">
						{count}
					</span>
				) : null}
			</button>

			{picked ? (
				<button
					type="button"
					onClick={onRemove}
					aria-label={`Ubrat ${type.name}`}
					className="text-ink-faint hover:text-debt border-line/60 min-h-11 border-l px-2.5 text-sm"
				>
					−
				</button>
			) : null}
		</span>
	)
}
