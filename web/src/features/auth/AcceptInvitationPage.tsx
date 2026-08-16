import type { ReactNode, SubmitEvent } from 'react'
import { useState } from 'react'
import { Link, useSearchParams } from 'react-router'

import { useSession } from '@/app/session'
import { ClubMark } from '@/components/ClubMark'
import { Button } from '@/components/ui/Button'
import { Field } from '@/components/ui/Field'
import { ApiError } from '@/lib/api'

/**
 * Přijetí pozvánky i aktivace stávajícího účtu — z pohledu serveru je to tatáž
 * věc, jen jednou už členství existuje a podruhé vznikne. Uživateli je to jedno:
 * vyplní jméno a heslo a je uvnitř.
 *
 * Stránka je veřejná; token nese celé oprávnění, takže se sem chodí bez přihlášení.
 */
export function AcceptInvitationPage() {
	const [params] = useSearchParams()
	const { acceptInvitation } = useSession()
	const token = params.get('token') ?? ''

	const [name, setName] = useState('')
	const [password, setPassword] = useState('')
	const [repeat, setRepeat] = useState('')
	const [error, setError] = useState<string | null>(null)
	const [field, setField] = useState<string | undefined>(undefined)
	const [submitting, setSubmitting] = useState(false)

	async function submit(event: SubmitEvent<HTMLFormElement>) {
		event.preventDefault()
		setError(null)
		setField(undefined)

		if (password !== repeat) {
			setError('Hesla se neshodují.')
			setField('repeat')

			return
		}

		setSubmitting(true)

		try {
			await acceptInvitation(token, password, name.trim())
		} catch (cause) {
			setError(cause instanceof ApiError ? cause.message : 'Pozvánku se nepodařilo přijmout.')
			setField(cause instanceof ApiError ? cause.field : undefined)
			setSubmitting(false)
		}
	}

	if (token === '') {
		return (
			<Shell>
				<h1 className="text-xl font-semibold">Odkaz není úplný</h1>
				<p className="text-ink-muted mt-2 text-sm">
					V adrese chybí kód pozvánky. Zkuste odkaz otevřít znovu celý, nebo si od admina nechte poslat nový.
				</p>
				<Link to="/prihlaseni" className="text-accent mt-6 inline-block text-sm">
					Zpátky na přihlášení
				</Link>
			</Shell>
		)
	}

	return (
		<Shell>
			<h1 className="text-2xl font-semibold tracking-tight">Vítejte v píně</h1>
			<p className="text-ink-muted mt-1 text-sm">Nastavte si heslo a jste uvnitř.</p>

			<form onSubmit={submit} className="mt-8 flex flex-col gap-4">
				<Field
					label="Jméno"
					value={name}
					onChange={(event) => setName(event.target.value)}
					autoComplete="name"
					required
					hint="Pod tímhle jménem vás uvidí zbytek družstva."
					error={field === 'name' ? (error ?? undefined) : undefined}
				/>
				<Field
					label="Heslo"
					type="password"
					value={password}
					onChange={(event) => setPassword(event.target.value)}
					autoComplete="new-password"
					required
					error={field === 'password' ? (error ?? undefined) : undefined}
				/>
				<Field
					label="Heslo ještě jednou"
					type="password"
					value={repeat}
					onChange={(event) => setRepeat(event.target.value)}
					autoComplete="new-password"
					required
					error={field === 'repeat' ? (error ?? undefined) : undefined}
				/>

				{error === null || field !== undefined ? null : (
					<p role="alert" className="bg-debt-500/15 text-debt rounded-xl px-3 py-2 text-sm">
						{error}
					</p>
				)}

				<Button type="submit" variant="accent" size="lg" fullWidth loading={submitting}>
					Vstoupit do aplikace
				</Button>
			</form>

			<p className="text-ink-faint mt-8 text-xs">
				Odkaz platí 72 hodin a jde použít jen jednou. Když už vypršel, požádejte admina o nový.
			</p>
		</Shell>
	)
}

function Shell({ children }: { children: ReactNode }) {
	return (
		<main className="relative grid min-h-dvh place-items-center overflow-hidden px-5 py-10">
			<div
				aria-hidden="true"
				className="from-brand-500/25 pointer-events-none absolute inset-x-0 top-0 h-80 bg-radial to-transparent to-70%"
			/>
			<div className="relative w-full max-w-sm">
				<ClubMark className="mb-6 h-16" />
				{children}
			</div>
		</main>
	)
}
