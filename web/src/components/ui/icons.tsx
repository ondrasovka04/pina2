import type { SVGProps } from 'react'

// Vlastní sada — jednoduchých tahů pod deset, tahat balík by nemělo smysl.
type IconProps = SVGProps<SVGSVGElement>

function Icon({ children, ...rest }: IconProps) {
	return (
		<svg
			viewBox="0 0 24 24"
			fill="none"
			stroke="currentColor"
			strokeWidth="1.75"
			strokeLinecap="round"
			strokeLinejoin="round"
			aria-hidden="true"
			className="size-6 shrink-0"
			{...rest}
		>
			{children}
		</svg>
	)
}

export function WalletIcon(props: IconProps) {
	return (
		<Icon {...props}>
			<path d="M3 8a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2" />
			<path d="M3 8v9a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-3" />
			<path d="M21 14h-4a2 2 0 0 1 0-4h4z" />
		</Icon>
	)
}

export function PlusIcon(props: IconProps) {
	return (
		<Icon {...props}>
			<path d="M12 5v14M5 12h14" />
		</Icon>
	)
}

export function CalendarIcon(props: IconProps) {
	return (
		<Icon {...props}>
			<rect x="3" y="5" width="18" height="16" rx="2" />
			<path d="M3 10h18M8 3v4M16 3v4" />
		</Icon>
	)
}

export function CarIcon(props: IconProps) {
	return (
		<Icon {...props}>
			<path d="M5 17h14M4 17v-4l2-5a2 2 0 0 1 1.9-1.4h8.2A2 2 0 0 1 18 8l2 5v4" />
			<path d="M4 13h16" />
			<path d="M7.5 17v1.5M16.5 17v1.5" />
		</Icon>
	)
}

export function MapPinIcon(props: IconProps) {
	return (
		<Icon {...props}>
			<path d="M12 21s7-5.5 7-11a7 7 0 1 0-14 0c0 5.5 7 11 7 11z" />
			<circle cx="12" cy="10" r="2.5" />
		</Icon>
	)
}

export function ListIcon(props: IconProps) {
	return (
		<Icon {...props}>
			<path d="M8 6h13M8 12h13M8 18h13" />
			<path d="M3.5 6h.01M3.5 12h.01M3.5 18h.01" />
		</Icon>
	)
}

export function UserIcon(props: IconProps) {
	return (
		<Icon {...props}>
			<circle cx="12" cy="8" r="4" />
			<path d="M4 20a8 8 0 0 1 16 0" />
		</Icon>
	)
}

export function ChevronDownIcon(props: IconProps) {
	return (
		<Icon {...props}>
			<path d="m6 9 6 6 6-6" />
		</Icon>
	)
}

export function ChevronRightIcon(props: IconProps) {
	return (
		<Icon {...props}>
			<path d="m9 6 6 6-6 6" />
		</Icon>
	)
}

export function ArrowLeftIcon(props: IconProps) {
	return (
		<Icon {...props}>
			<path d="M19 12H5M11 6l-6 6 6 6" />
		</Icon>
	)
}

export function CheckIcon(props: IconProps) {
	return (
		<Icon {...props}>
			<path d="m5 13 4 4 10-10" />
		</Icon>
	)
}

export function XIcon(props: IconProps) {
	return (
		<Icon {...props}>
			<path d="M6 6l12 12M18 6 6 18" />
		</Icon>
	)
}

/** Úchyt pro přetahování — šest teček je zavedená značka pro „tady chytni". */
export function GripIcon(props: IconProps) {
	return (
		<Icon strokeWidth="2.5" {...props}>
			<path d="M9 6h.01M15 6h.01M9 12h.01M15 12h.01M9 18h.01M15 18h.01" />
		</Icon>
	)
}

export function SearchIcon(props: IconProps) {
	return (
		<Icon {...props}>
			<circle cx="11" cy="11" r="7" />
			<path d="m20 20-3.5-3.5" />
		</Icon>
	)
}
