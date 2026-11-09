import type { SubmitEvent } from 'react'
import { useState } from 'react'

import { useCurrentUser, useSession } from '@/app/session'
import { Button } from '@/components/ui/Button'
import { Card, CardHeader } from '@/components/ui/Card'
import { Field } from '@/components/ui/Field'
import { ApiError } from '@/lib/api'
import { formatPhone } from '@/lib/phone'
import { useSavePhone } from '@/lib/queries'

export function PhoneCard() {
	const user = useCurrentUser()
	const { refreshUser } = useSession()
	const save = useSavePhone()
	const [phone, setPhone] = useState(user.phone === null ? '' : formatPhone(user.phone))
	const [error, setError] = useState<string | undefined>()
	const [saved, setSaved] = useState(false)

	async function submit(event: SubmitEvent<HTMLFormElement>) {
		event.preventDefault()
		setError(undefined)
		setSaved(false)

		try {
			const result = await save.mutateAsync(phone.trim() === '' ? null : phone)
			setPhone(result.phone === null ? '' : formatPhone(result.phone))
			setSaved(true)
			// Selhání obnovení profilu nesmí vydávat uložený telefon za neuložený.
			await refreshUser().catch(() => undefined)
		} catch (cause) {
			setError(cause instanceof ApiError ? cause.message : 'Telefon se nepodařilo uložit. Zkuste to znovu.')
		}
	}

	return (
		<Card>
			<CardHeader
				title="Telefon"
				subtitle="Číslo uvidí spoluhráči ve vašich družstvech v Kontaktech — hodí se třeba při domlouvání odvozů."
			/>
			<form onSubmit={(event) => void submit(event)} className="flex min-w-0 flex-col gap-3 p-4">
				<Field
					label="Telefonní číslo (nepovinné)"
					type="tel"
					inputMode="tel"
					autoComplete="tel"
					placeholder="777 123 456"
					value={phone}
					disabled={save.isPending}
					className="w-full max-w-full min-w-0"
					onChange={(event) => {
						setPhone(event.target.value)
						setSaved(false)
						setError(undefined)
					}}
					error={error}
					hint="Stačí 9 číslic, předvolbu +420 doplníme. Vymazáním čísla a uložením kontakt odstraníte."
				/>
				<Button type="submit" loading={save.isPending}>
					Uložit telefon
				</Button>
				{saved ? (
					<p role="status" className="text-ink-muted text-sm">
						Telefon je uložený.
					</p>
				) : null}
			</form>
		</Card>
	)
}
