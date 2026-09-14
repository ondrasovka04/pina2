import czechiaLogo from '@/assets/czechia.png'

export function HostingFooter() {
	return (
		<footer className="border-line/60 text-ink-muted border-t px-4 py-2 text-center">
			<a
				href="https://czechia.com"
				target="_blank"
				rel="noopener noreferrer"
				className="inline-flex min-h-11 max-w-full items-center gap-3 rounded-lg text-left text-xs"
			>
				<span>
					Tento web hostuje na serverech <span className="font-medium underline underline-offset-2">CZECHIA.COM</span>
				</span>
				<span className="bg-brand-50 shrink-0 rounded-lg px-2 py-1.5">
					<img src={czechiaLogo} alt="" width={128} height={34} className="h-auto w-24" />
				</span>
			</a>
		</footer>
	)
}
