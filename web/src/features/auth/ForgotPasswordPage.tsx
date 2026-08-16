import type { SubmitEvent } from 'react'
import { useState } from 'react'
import { Link } from 'react-router'

import { Button } from '@/components/ui/Button'
import { Field } from '@/components/ui/Field'
import { AuthShell } from '@/features/auth/AuthShell'
import { api } from '@/lib/api'
import { emailError } from '@/lib/validation'

/**
 * Vyžádání odkazu na nové heslo.
 *
 * Potvrzení je schválně neurčité („pokud je adresa u nás"). Kdyby aplikace
 * rozlišovala známou a neznámou adresu, dala by se přes tenhle formulář
 * zjišťovat, kdo v ní je.
 */
export function ForgotPasswordPage() {
	const [email, setEmail] = useState('')
	const [error, setError] = useState<string | null>(null)
	const [submitting, setSubmitting] = useState(false)
	const [sent, setSent] = useState(false)

	async function submit(event: SubmitEvent<HTMLFormElement>) {
		event.preventDefault()

		const invalid = emailError(email)
		if (invalid !== undefined) {
			setError(invalid)

			return
		}

		setError(null)
		setSubmitting(true)

		try {
			await api.post('/auth/password/forgot', { email: email.trim() })
			setSent(true)
		} catch {
			// I selhání se zamlčuje — jinak by se z chování daly adresy odhadovat.
			setSent(true)
		}
	}

	if (sent) {
		return (
			<AuthShell>
				<h1 className="text-2xl font-semibold tracking-tight">Odkaz je na cestě</h1>
				<p className="text-ink-muted mt-3 text-sm">
					Pokud adresu <span className="text-ink font-medium">{email.trim()}</span> známe, poslali jsme na ni odkaz na
					nastavení nového hesla. Platí hodinu.
				</p>
				<p className="text-ink-faint mt-3 text-sm">Nepřišel? Mrkněte do spamu, nebo to za chvíli zkuste znovu.</p>
				<Link to="/prihlaseni" className="text-accent mt-6 inline-block text-sm">
					Zpátky na přihlášení
				</Link>
			</AuthShell>
		)
	}

	return (
		<AuthShell>
			<h1 className="text-2xl font-semibold tracking-tight">Zapomenuté heslo</h1>
			<p className="text-ink-muted mt-1 text-sm">Pošleme vám odkaz, kterým si nastavíte nové.</p>

			<form onSubmit={submit} noValidate className="mt-8 flex flex-col gap-4">
				<Field
					label="E-mail"
					type="email"
					value={email}
					onChange={(event) => {
						setEmail(event.target.value)
						setError(null)
					}}
					autoComplete="email"
					inputMode="email"
					autoCapitalize="off"
					error={error ?? undefined}
				/>

				<Button type="submit" variant="accent" size="lg" fullWidth loading={submitting}>
					Poslat odkaz
				</Button>
			</form>

			<Link to="/prihlaseni" className="text-ink-muted mt-6 inline-block text-sm">
				Zpátky na přihlášení
			</Link>
		</AuthShell>
	)
}
