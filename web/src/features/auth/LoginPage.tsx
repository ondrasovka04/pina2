import type { SubmitEvent } from 'react'
import { useState } from 'react'
import { Link } from 'react-router'

import { useSession } from '@/app/session'
import { ClubMark } from '@/components/ClubMark'
import { Button } from '@/components/ui/Button'
import { Field } from '@/components/ui/Field'
import { ApiError } from '@/lib/api'
import { emailError, requiredError } from '@/lib/validation'

export function LoginPage() {
	const { signIn } = useSession()
	const [email, setEmail] = useState('')
	const [password, setPassword] = useState('')
	const [error, setError] = useState<string | null>(null)
	const [submitting, setSubmitting] = useState(false)

	async function handleSubmit(event: SubmitEvent<HTMLFormElement>) {
		event.preventDefault()

		const invalid = emailError(email) ?? requiredError(password, 'Vyplňte heslo.')
		if (invalid !== undefined) {
			setError(invalid)

			return
		}

		setError(null)
		setSubmitting(true)

		try {
			await signIn(email.trim(), password)
		} catch (cause) {
			setError(
				cause instanceof ApiError
					? cause.message
					: 'Přihlášení se nepodařilo. Zkontrolujte připojení a zkuste to znovu.',
			)
			setSubmitting(false)
		}
	}

	return (
		<main className="relative grid min-h-dvh place-items-center overflow-hidden px-5 py-10">
			<div
				aria-hidden="true"
				className="from-brand-500/25 pointer-events-none absolute inset-x-0 top-0 h-80 bg-radial to-transparent to-70%"
			/>

			<div className="relative w-full max-w-sm">
				<div className="flex flex-col items-center gap-4 text-center">
					<ClubMark className="h-20" />
					<div>
						<h1 className="text-3xl font-semibold tracking-tight">Pína</h1>
						<p className="text-ink-muted mt-1 text-sm">Týmová kasa SK Prosek Praha</p>
					</div>
				</div>

				<form onSubmit={handleSubmit} noValidate className="mt-8 flex flex-col gap-4">
					<Field
						label="E-mail"
						type="email"
						name="email"
						value={email}
						onChange={(event) => setEmail(event.target.value)}
						autoComplete="email"
						inputMode="email"
						autoCapitalize="off"
					/>
					<Field
						label="Heslo"
						type="password"
						name="password"
						value={password}
						onChange={(event) => setPassword(event.target.value)}
						autoComplete="current-password"
					/>

					{error === null ? null : (
						<p role="alert" className="bg-debt-500/15 text-debt rounded-xl px-3 py-2 text-sm">
							{error}
						</p>
					)}

					<Button type="submit" variant="accent" size="lg" fullWidth loading={submitting}>
						Přihlásit se
					</Button>
				</form>

				<p className="mt-6 text-center text-sm">
					<Link to="/zapomenute-heslo" className="text-accent">
						Zapomenuté heslo?
					</Link>
				</p>

				<p className="text-ink-faint mt-8 text-center text-xs">Přístup do aplikace zakládá admin družstva.</p>
			</div>
		</main>
	)
}
