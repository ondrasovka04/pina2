import type { SubmitEvent } from 'react'
import { useState } from 'react'

import { useTeam } from '@/app/team'
import { Button } from '@/components/ui/Button'
import { Field } from '@/components/ui/Field'
import { ApiError } from '@/lib/api'
import { useCreateTeam } from '@/lib/queries'

/**
 * Založení dalšího družstva ve stejném klubu.
 *
 * Tohle je odpověď na otázku, kdo vytvoří admina nového družstva: jeho
 * zakladatel. Admin mužů takhle založí juniory a je jejich adminem, dokud roli
 * nepředá trenérovi. Nikde k tomu není potřeba pevně zadané ID ani zásah do
 * databáze — server přiděluje roli podle toho, kdo požadavek poslal.
 */
export function NewTeamSection({ clubId, clubName }: { clubId: number; clubName: string }) {
	const { selectTeam } = useTeam()
	const [open, setOpen] = useState(false)
	const [name, setName] = useState('')
	const [error, setError] = useState<string | null>(null)
	const create = useCreateTeam(clubId)

	async function submit(event: SubmitEvent<HTMLFormElement>) {
		event.preventDefault()
		setError(null)

		try {
			const team = await create.mutateAsync({ name: name.trim() })
			setName('')
			setOpen(false)
			// Přepnutí na nové družstvo rovnou — jinak by ho člověk musel hledat
			// v přepínači a nebylo by poznat, že se něco stalo.
			selectTeam(team.id)
		} catch (cause) {
			setError(cause instanceof ApiError ? cause.message : 'Družstvo se nepodařilo založit.')
		}
	}

	return (
		<details
			open={open}
			onToggle={(event) => setOpen(event.currentTarget.open)}
			className="border-line bg-surface-1 overflow-hidden rounded-2xl border"
		>
			<summary className="cursor-pointer px-4 py-3 font-medium select-none">Založit další družstvo</summary>

			<div className="border-line/60 border-t px-4 py-4">
				<form onSubmit={submit} className="flex flex-col gap-3">
					<Field
						label="Název družstva"
						value={name}
						onChange={(event) => setName(event.target.value)}
						placeholder="Prosek — junioři"
						required
						error={error ?? undefined}
						hint={`Vznikne v klubu ${clubName} a vy budete jeho adminem. Sezónu a sazebník mu založíte potom.`}
					/>
					<Button type="submit" loading={create.isPending}>
						Založit družstvo
					</Button>
				</form>
			</div>
		</details>
	)
}
