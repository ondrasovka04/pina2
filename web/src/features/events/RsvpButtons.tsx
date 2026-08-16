import { Button } from '@/components/ui/Button'
import { CheckIcon, XIcon } from '@/components/ui/icons'
import type { Rsvp } from '@/lib/types'

interface RsvpButtonsProps {
	value: Rsvp
	onChange: (rsvp: Rsvp) => void
	/** Která odpověď se právě ukládá; obě tlačítka se mezitím zamknou. */
	pending?: Rsvp | null
	size?: 'md' | 'lg'
	disabled?: boolean
}

/** Dvojice „Přijdu / Nepřijdu", schválně jedna komponenta — dřív byla v kalendáři zlatá a v detailu modrá. */
export function RsvpButtons({ value, onChange, pending = null, size = 'lg', disabled = false }: RsvpButtonsProps) {
	const busy = pending !== null

	return (
		<div className="flex gap-2">
			<Button
				variant={value === 'yes' ? 'accent' : 'ghost'}
				size={size}
				fullWidth
				aria-pressed={value === 'yes'}
				loading={pending === 'yes'}
				disabled={disabled || (busy && pending !== 'yes')}
				onClick={() => onChange('yes')}
			>
				<CheckIcon className="size-5" />
				Přijdu
			</Button>
			<Button
				variant={value === 'no' ? 'danger' : 'ghost'}
				size={size}
				fullWidth
				aria-pressed={value === 'no'}
				loading={pending === 'no'}
				disabled={disabled || (busy && pending !== 'no')}
				onClick={() => onChange('no')}
			>
				<XIcon className="size-5" />
				Nepřijdu
			</Button>
		</div>
	)
}
