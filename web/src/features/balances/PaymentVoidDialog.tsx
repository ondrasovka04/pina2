import { useEffect, useState } from 'react'

import { ConfirmDialog } from '@/components/ui/ConfirmDialog'
import { Field } from '@/components/ui/Field'

interface PaymentVoidDialogProps {
	open: boolean
	onConfirm: (reason: string) => void
	onCancel: () => void
}

export function PaymentVoidDialog({ open, onConfirm, onCancel }: PaymentVoidDialogProps) {
	const [reason, setReason] = useState('')

	useEffect(() => {
		if (open) {
			setReason('')
		}
	}, [open])

	const normalized = reason.trim()

	return (
		<ConfirmDialog
			open={open}
			title="Stornovat platbu?"
			description="Platba zůstane v historii, ale znovu se přičte k dluhu. Důvod se uloží do provozní stopy."
			confirmLabel="Stornovat"
			confirmDisabled={normalized === ''}
			danger
			onConfirm={() => onConfirm(normalized)}
			onCancel={onCancel}
		>
			<Field
				label="Důvod storna"
				value={reason}
				maxLength={500}
				placeholder="Např. platba byla zapsána dvakrát"
				onChange={(event) => setReason(event.target.value)}
			/>
		</ConfirmDialog>
	)
}
