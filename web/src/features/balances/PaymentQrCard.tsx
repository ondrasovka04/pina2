import { useEffect, useState } from 'react'

import { Button } from '@/components/ui/Button'
import { Card } from '@/components/ui/Card'
import { Money } from '@/components/ui/Money'
import { usePaymentQr } from '@/lib/queries'

interface PaymentQrCardProps {
	seasonId: number
	membershipId: number
	/** Pínař si otevře QR cizího hráče, aby mu ho podržel před očima v šatně. */
	title?: string
}

export function PaymentQrCard({ seasonId, membershipId, title = 'Zaplatit pínu' }: PaymentQrCardProps) {
	const qr = usePaymentQr(seasonId, membershipId)
	const [revealed, setRevealed] = useState(false)
	const [image, setImage] = useState<string | null>(null)
	const [drawFailed, setDrawFailed] = useState(false)

	useEffect(() => {
		const spayd = qr.data?.spayd
		if (!revealed || spayd === null || spayd === undefined) {
			setImage(null)
			return
		}

		let active = true
		setDrawFailed(false)
		void import('qrcode')
			.then(({ default: QRCode }) =>
				QRCode.toDataURL(spayd, {
					width: 320,
					margin: 2,
					errorCorrectionLevel: 'M',
					color: { dark: '#101828', light: '#ffffff' },
				}),
			)
			.then((url) => {
				if (active) setImage(url)
			})
			// Knihovna se dotahuje zvlášť, takže v hale bez signálu nemusí dojít.
			// Číslo účtu a VS pod obrázkem stačí k ruční platbě — čekání naslepo ne.
			.catch(() => {
				if (active) setDrawFailed(true)
			})

		return () => {
			active = false
		}
	}, [qr.data?.spayd, revealed])

	// Karta je doplněk pod zůstatkem: kdo nic nedluží, ji neuvidí vůbec. Proto se
	// při načítání nic nevykreslí — jinak by na stránce bliknul velký spinner a zmizel.
	if (qr.isPending) return null
	if (qr.error !== null) {
		return (
			<Card className="flex flex-wrap items-center justify-between gap-2 px-4 py-3">
				<p className="text-ink-muted text-sm">Platební QR se nepodařilo připravit.</p>
				<Button variant="ghost" size="sm" onClick={() => void qr.refetch()}>
					Zkusit znovu
				</Button>
			</Card>
		)
	}

	const data = qr.data
	if (data.amountCzk <= 0) return null

	return (
		<Card className="overflow-hidden">
			<div className="flex flex-wrap items-center justify-between gap-3 px-4 py-4">
				<div>
					<h2 className="font-semibold">{title}</h2>
					<p className="text-ink-muted mt-0.5 text-sm">{data.period.name}</p>
				</div>
				<Money czk={data.amountCzk} tone="balance" className="text-xl font-semibold" />
			</div>

			{data.bankAccount === null ? (
				<p className="border-line/60 text-ink-muted border-t px-4 py-3 text-sm">
					Družstvo zatím nemá nastavený účet pro QR platby.
				</p>
			) : revealed ? (
				<div className="border-line/60 flex flex-col items-center gap-3 border-t px-4 py-4 text-center">
					{drawFailed ? (
						<p className="text-ink-muted py-6 text-sm">QR kód se nepodařilo vykreslit, zaplaťte podle údajů níže.</p>
					) : image === null ? (
						<p className="text-ink-muted py-16 text-sm">Připravuji QR kód…</p>
					) : (
						<img src={image} alt={`QR platba ${data.amountCzk} Kč`} className="aspect-square w-full max-w-72" />
					)}
					<p className="text-ink-muted text-sm">
						Účet {data.bankAccount} · VS {data.variableSymbol}
					</p>
					<Button variant="ghost" size="sm" onClick={() => setRevealed(false)}>
						Skrýt QR
					</Button>
				</div>
			) : (
				<div className="border-line/60 border-t px-4 py-3">
					<Button variant="accent" fullWidth onClick={() => setRevealed(true)}>
						Zobrazit QR platbu
					</Button>
				</div>
			)}
		</Card>
	)
}
