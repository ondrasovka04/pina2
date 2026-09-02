import type { ReactNode } from 'react'
import { useState } from 'react'
import { Link } from 'react-router'

import { useTeam } from '@/app/team'
import { NoSeasonState } from '@/components/NoSeasonState'
import { Avatar } from '@/components/ui/Avatar'
import { Button } from '@/components/ui/Button'
import { Card } from '@/components/ui/Card'
import { ConfirmDialog } from '@/components/ui/ConfirmDialog'
import { ArrowLeftIcon, XIcon } from '@/components/ui/icons'
import { Money } from '@/components/ui/Money'
import { EmptyState, ErrorState, LoadingState } from '@/components/ui/States'
import { PaymentVoidDialog } from '@/features/balances/PaymentVoidDialog'
import { itemsInPeriod, periodByKey, teamSums } from '@/features/balances/period'
import { PeriodTabs } from '@/features/balances/PeriodTabs'
import { cn } from '@/lib/cn'
import {
	useBalances,
	usePayments,
	useSyncTravelClaims,
	useTravelClaims,
	useVoidPayment,
	useVoidTravelClaim,
} from '@/lib/queries'
import type { Payment, PeriodKey, TravelClaim } from '@/lib/types'
import { formatCzk, formatDate } from '@/lib/types'

type MoneyTab = 'payments' | 'travel'

const methodLabels: Record<Payment['method'], string> = {
	cash: 'Hotovost',
	transfer: 'Bankovní převod',
	qr: 'QR platba',
	gateway: 'Platební brána',
}

/**
 * Přehled peněz, které do píny přišly a odešly. Zápisy prohřešků mají vlastní
 * obrazovku (`/zapisy`), tady jsou platby a cesťáky — bez toho se pínař dostal
 * k cesťáku jen tak, že prošel hráče jednoho po druhém.
 */
export function PaymentsPage() {
	const { team, seasonId, can, isSeasonClosed, usesAttendance } = useTeam()
	const balances = useBalances(seasonId)
	const payments = usePayments(seasonId)
	const claims = useTravelClaims(seasonId)
	const syncTravel = useSyncTravelClaims(seasonId ?? 0)
	const voidPayment = useVoidPayment(seasonId ?? 0)
	const voidClaim = useVoidTravelClaim(seasonId ?? 0)

	const [tab, setTab] = useState<MoneyTab>('payments')
	const [period, setPeriod] = useState<PeriodKey>('all')
	const [voidingPaymentId, setVoidingPaymentId] = useState<number | null>(null)
	const [voidingClaimId, setVoidingClaimId] = useState<number | null>(null)
	const [syncMessage, setSyncMessage] = useState<string | null>(null)

	if (seasonId === null) return <NoSeasonState />
	if (balances.isPending || payments.isPending || claims.isPending) return <LoadingState />
	if (balances.error !== null) return <ErrorState error={balances.error} onRetry={() => void balances.refetch()} />
	if (payments.error !== null) return <ErrorState error={payments.error} onRetry={() => void payments.refetch()} />
	if (claims.error !== null) return <ErrorState error={claims.error} onRetry={() => void claims.refetch()} />

	const canManage = can('treasurer') && !isSeasonClosed
	const travelEnabled = team?.travelEnabled === true
	/**
	 * Družstvo bez cesťáků nemá důvod vidět jejich záložku. Zůstává jen tehdy,
	 * když nějaké vznikly dřív — jsou to peníze, které pořád snižují dluh, a
	 * schovat je kvůli přepnutí nastavení by bylo horší než ukázat víc.
	 */
	const showTravel = travelEnabled || claims.data.length > 0
	const activeTab: MoneyTab = showTravel ? tab : 'payments'
	const bounds = periodByKey(balances.data.periods, period)
	const totals = teamSums(balances.data, period)

	// Seznamy jsou datované položky, takže se zúží podle stejné hranice jako součty.
	const visiblePayments = itemsInPeriod(payments.data, (item) => item.paidOn, bounds)
	const visibleClaims = itemsInPeriod(claims.data, (item) => item.occurredOn, bounds)
	const live = { payments: visiblePayments.filter(open), travel: visibleClaims.filter(open) }

	return (
		<div className="flex flex-col gap-4">
			<PaymentVoidDialog
				open={voidingPaymentId !== null}
				onConfirm={(reason) => {
					if (voidingPaymentId !== null) voidPayment.mutate({ paymentId: voidingPaymentId, reason })
					setVoidingPaymentId(null)
				}}
				onCancel={() => setVoidingPaymentId(null)}
			/>
			<ConfirmDialog
				open={voidingClaimId !== null}
				title="Stornovat cesťák?"
				description="Náhrada zůstane v historii, ale přestane snižovat dluh hráče. Načtení z odehraných zápasů ji už nevrátí."
				confirmLabel="Stornovat"
				danger
				onConfirm={() => {
					if (voidingClaimId !== null) voidClaim.mutate(voidingClaimId)
					setVoidingClaimId(null)
				}}
				onCancel={() => setVoidingClaimId(null)}
			/>

			<Link to="/dluhy" className="text-ink-muted hover:text-ink inline-flex items-center gap-1.5 text-sm">
				<ArrowLeftIcon className="size-4" />
				Dluhy
			</Link>

			<Card className="overflow-hidden">
				<div className="px-4 py-4">
					<h1 className="text-lg font-semibold">{showTravel ? 'Platby a cesťáky' : 'Platby'}</h1>
					<p className="text-ink-muted mt-1 text-sm">
						Zaplaceno {formatCzk(totals.paidCzk)}
						{showTravel ? ` · cesťáky ${formatCzk(totals.travelCzk)}` : ''}
					</p>
				</div>
				<PeriodTabs periods={balances.data.periods} active={period} onChange={setPeriod} />
			</Card>

			{showTravel ? (
				<div className="bg-surface-2 flex rounded-lg p-0.5 text-sm">
					<Tab active={activeTab === 'payments'} onClick={() => setTab('payments')}>
						Platby ({live.payments.length})
					</Tab>
					<Tab active={activeTab === 'travel'} onClick={() => setTab('travel')}>
						Cesťáky ({live.travel.length})
					</Tab>
				</div>
			) : null}

			{activeTab === 'travel' && canManage && travelEnabled && usesAttendance ? (
				<Card className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
					<div>
						<p className="text-sm font-medium">Doplnit z odehraných zápasů</p>
						<p className="text-ink-muted text-sm">Za každého řidiče venkovního zápasu podle sazby družstva.</p>
						{syncMessage === null ? null : <p className="text-ink-faint mt-1 text-xs">{syncMessage}</p>}
					</div>
					<Button
						variant="ghost"
						size="sm"
						loading={syncTravel.isPending}
						onClick={() => {
							setSyncMessage(null)
							syncTravel.mutate(undefined, {
								onSuccess: (result) =>
									setSyncMessage(`Nové ${result.created}, upravené ${result.updated}, stornované ${result.voided}.`),
							})
						}}
					>
						Načíst
					</Button>
				</Card>
			) : null}

			{/* Vypnuté cesťáky s historií: pínař musí vědět, proč žádný nový nepřibývá. */}
			{activeTab === 'travel' && !travelEnabled ? (
				<p className="text-ink-faint text-xs">
					Cesťáky jsou v nastavení družstva vypnuté, takže tohle je jen jejich historie.
				</p>
			) : null}

			{activeTab === 'payments' ? (
				visiblePayments.length === 0 ? (
					<EmptyState
						title={period === 'all' ? 'Zatím žádná platba' : 'V tomhle pololetí žádná platba'}
						description="Přijatou platbu zapíše pínař u konkrétního hráče v jeho kartě."
					/>
				) : (
					<Card className="divide-line/50 divide-y">
						{visiblePayments.map((payment) => (
							<Row
								key={payment.id}
								membershipId={payment.membershipId}
								name={payment.memberName}
								imageUrl={payment.memberAvatarUrl}
								title={methodLabels[payment.method]}
								detail={`${formatDate(payment.paidOn)}${payment.note === null ? '' : ` · ${payment.note}`}`}
								amountCzk={-payment.amountCzk}
								voided={payment.voidedAt !== null}
								onVoid={canManage ? () => setVoidingPaymentId(payment.id) : undefined}
								voiding={voidPayment.isPending}
								voidLabel="Stornovat platbu"
							/>
						))}
					</Card>
				)
			) : visibleClaims.length === 0 ? (
				<EmptyState
					title={period === 'all' ? 'Zatím žádný cesťák' : 'V tomhle pololetí žádný cesťák'}
					description={
						usesAttendance
							? 'Načtou se z odehraných venkovních zápasů podle toho, kdo u nich jel autem.'
							: 'Ruční cesťák zapíše pínař u konkrétního hráče v jeho kartě.'
					}
				/>
			) : (
				<Card className="divide-line/50 divide-y">
					{visibleClaims.map((claim) => (
						<Row
							key={claim.id}
							membershipId={claim.membershipId}
							name={claim.memberName}
							imageUrl={claim.memberAvatarUrl}
							title={claim.eventTitle ?? claim.note ?? 'Ruční cesťák'}
							detail={`${formatDate(claim.occurredOn)} · ${claim.distanceKm} km × ${formatCzk(claim.rateCzkKm)}`}
							amountCzk={-claim.amountCzk}
							voided={claim.voidedAt !== null}
							onVoid={canManage ? () => setVoidingClaimId(claim.id) : undefined}
							voiding={voidClaim.isPending}
							voidLabel="Stornovat cesťák"
						/>
					))}
				</Card>
			)}
		</div>
	)
}

function open(item: Payment | TravelClaim): boolean {
	return item.voidedAt === null
}

function Tab({ active, onClick, children }: { active: boolean; onClick: () => void; children: ReactNode }) {
	return (
		<button
			type="button"
			onClick={onClick}
			aria-pressed={active}
			className={cn(
				'min-h-9 flex-1 rounded-md px-3 transition-colors',
				active ? 'bg-brand-600 text-white' : 'text-ink-muted',
			)}
		>
			{children}
		</button>
	)
}

interface RowProps {
	membershipId: number
	name: string
	imageUrl: string | null
	title: string
	detail: string
	amountCzk: number
	voided: boolean
	voiding: boolean
	voidLabel: string
	onVoid?: (() => void) | undefined
}

function Row({ membershipId, name, imageUrl, title, detail, amountCzk, voided, voiding, voidLabel, onVoid }: RowProps) {
	return (
		<div className={cn('flex items-center gap-3 px-4 py-3', voided && 'opacity-50')}>
			<Avatar name={name} src={imageUrl} size="sm" />
			<div className="min-w-0 flex-1">
				<p className={cn('truncate font-medium', voided && 'line-through')}>
					<Link to={`/hraci/${membershipId}`} className="hover:underline">
						{name}
					</Link>
					{voided ? <span className="text-ink-faint ml-2 text-xs font-normal">stornováno</span> : null}
				</p>
				<p className="text-ink-faint truncate text-xs">
					{title} · {detail}
				</p>
			</div>
			<Money czk={amountCzk} className={cn(voided && 'line-through')} />
			{onVoid === undefined || voided ? null : (
				<button
					type="button"
					onClick={onVoid}
					disabled={voiding}
					aria-label={voidLabel}
					className="text-ink-faint hover:bg-surface-2 hover:text-debt inline-flex size-9 shrink-0 items-center justify-center rounded-lg transition-colors disabled:cursor-not-allowed disabled:opacity-50"
				>
					<XIcon className="size-4" />
				</button>
			)}
		</div>
	)
}
