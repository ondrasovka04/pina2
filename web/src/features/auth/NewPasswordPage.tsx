import type { SubmitEvent } from 'react'
import { useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router'

import { useSession } from '@/app/session'
import { Button } from '@/components/ui/Button'
import { Field } from '@/components/ui/Field'
import { AuthShell } from '@/features/auth/AuthShell'
import { ApiError } from '@/lib/api'
import { requiredError } from '@/lib/validation'

/** Nastavení nového hesla podle odkazu z e-mailu. Po uložení rovnou přihlásí. */
export function NewPasswordPage() {
	const [params] = useSearchParams()
	const { resetPassword } = useSession()
	const navigate = useNavigate()
	const token = params.get('token') ?? ''

	const [password, setPassword] = useState('')
	const [repeat, setRepeat] = useState('')
	const [error, setError] = useState<string | null>(null)
	const [field, setField] = useState<string | undefined>(undefined)
	const [submitting, setSubmitting] = useState(false)

	async function submit(event: SubmitEvent<HTMLFormElement>) {
		event.preventDefault()
		setError(null)
		setField(undefined)

		const missing = requiredError(password, 'Vyplňte heslo.')
		if (missing !== undefined) {
			setError(missing)
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
			await resetPassword(token, password)
			await navigate('/', { replace: true })
		} catch (cause) {
			setError(cause instanceof ApiError ? cause.message : 'Heslo se nepodařilo změnit.')
			setField(cause instanceof ApiError ? cause.field : undefined)
			setSubmitting(false)
		}
	}

	if (token === '') {
		return (
			<AuthShell>
				<h1 className="text-xl font-semibold">Odkaz není úplný</h1>
				<p className="text-ink-muted mt-2 text-sm">
					V adrese chybí kód. Otevřete odkaz z e-mailu celý, nebo si nechte poslat nový.
				</p>
				<Link to="/zapomenute-heslo" className="text-accent mt-6 inline-block text-sm">
					Poslat nový odkaz
				</Link>
			</AuthShell>
		)
	}

	return (
		<AuthShell>
			<h1 className="text-2xl font-semibold tracking-tight">Nové heslo</h1>
			<p className="text-ink-muted mt-1 text-sm">
				Po uložení vás odhlásíme ze všech ostatních zařízení a rovnou přihlásíme tady.
			</p>

			<form onSubmit={submit} noValidate className="mt-8 flex flex-col gap-4">
				<Field
					label="Nové heslo"
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
					Uložit a přihlásit
				</Button>
			</form>

			<p className="text-ink-faint mt-8 text-xs">Odkaz platí hodinu a jde použít jen jednou.</p>
		</AuthShell>
	)
}
