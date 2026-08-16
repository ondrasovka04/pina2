import type { SubmitEvent } from 'react'
import { useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router'

import { useSession } from '@/app/session'
import { Button } from '@/components/ui/Button'
import { Field } from '@/components/ui/Field'
import { AuthShell } from '@/features/auth/AuthShell'
import { ApiError } from '@/lib/api'
import { requiredError } from '@/lib/validation'

// Pozvánka i aktivace jsou pro server totéž. Stránka je veřejná, oprávnění nese token.
export function AcceptInvitationPage() {
	const [params] = useSearchParams()
	const { acceptInvitation, user } = useSession()
	const navigate = useNavigate()
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

		const missingName = requiredError(name, 'Vyplňte jméno.')
		if (missingName !== undefined) {
			setError(missingName)
			setField('name')

			return
		}

		const missingPassword = requiredError(password, 'Vyplňte heslo.')
		if (missingPassword !== undefined) {
			setError(missingPassword)
			setField('password')

			return
		}

		if (password !== repeat) {
			setError('Hesla se neshodují.')
			setField('repeat')

			return
		}

		setSubmitting(true)

		try {
			await acceptInvitation(token, password, name.trim())
			// Bez přesměrování by formulář visel s točícím se kolečkem
			await navigate('/kalendar', { replace: true })
		} catch (cause) {
			setError(cause instanceof ApiError ? cause.message : 'Pozvánku se nepodařilo přijmout.')
			setField(cause instanceof ApiError ? cause.field : undefined)
			setSubmitting(false)
		}
	}

	if (token === '') {
		return (
			<AuthShell>
				<h1 className="text-xl font-semibold">Odkaz není úplný</h1>
				<p className="text-ink-muted mt-2 text-sm">
					V adrese chybí kód pozvánky. Zkuste odkaz otevřít znovu celý, nebo si od admina nechte poslat nový.
				</p>
				<Link to="/prihlaseni" className="text-accent mt-6 inline-block text-sm">
					Zpátky na přihlášení
				</Link>
			</AuthShell>
		)
	}

	return (
		<AuthShell>
			<h1 className="text-2xl font-semibold tracking-tight">Vítejte v píně</h1>
			<p className="text-ink-muted mt-1 text-sm">Nastavte si heslo a jste uvnitř.</p>

			{/*
			 * Přijetím se relace přepne na účet, pro který byla pozvánka
			 * vystavená. Bez upozornění to vypadá jako chyba — člověk se rázem
			 * kouká na cizí dluhy.
			 */}
			{user === null ? null : (
				<p className="bg-surface-2 text-ink-muted mt-4 rounded-xl px-3 py-2 text-sm">
					Jste přihlášení jako <span className="text-ink font-medium">{user.name}</span>. Přijetím pozvánky se přepnete
					na účet, pro který byla vystavená.
				</p>
			)}

			<form onSubmit={submit} noValidate className="mt-8 flex flex-col gap-4">
				<Field
					label="Jméno"
					value={name}
					onChange={(event) => setName(event.target.value)}
					autoComplete="name"
					hint="Pod tímhle jménem vás uvidí zbytek družstva."
					error={field === 'name' ? (error ?? undefined) : undefined}
				/>
				<Field
					label="Heslo"
					type="password"
					value={password}
					onChange={(event) => setPassword(event.target.value)}
					autoComplete="new-password"
					error={field === 'password' ? (error ?? undefined) : undefined}
				/>
				<Field
					label="Heslo ještě jednou"
					type="password"
					value={repeat}
					onChange={(event) => setRepeat(event.target.value)}
					autoComplete="new-password"
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
		</AuthShell>
	)
}
