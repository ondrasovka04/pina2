import type { SubmitEvent } from 'react'
import { useState } from 'react'
import { Link, Navigate, useParams } from 'react-router'

import { useTeam } from '@/app/team'
import { NoSeasonState } from '@/components/NoSeasonState'
import { Avatar } from '@/components/ui/Avatar'
import { Button } from '@/components/ui/Button'
import { Card } from '@/components/ui/Card'
import { ConfirmDialog } from '@/components/ui/ConfirmDialog'
import { Field } from '@/components/ui/Field'
import { ArrowLeftIcon, XIcon } from '@/components/ui/icons'
import { Money } from '@/components/ui/Money'
import { Select } from '@/components/ui/Select'
import { EmptyState, ErrorState, LoadingState } from '@/components/ui/States'
import { PaymentQrCard } from '@/features/balances/PaymentQrCard'
import { periodByKey } from '@/features/balances/period'
import { ApiError } from '@/lib/api'
import { cn } from '@/lib/cn'
import { records as recordsLabel } from '@/lib/plural'
import {
	useBalances,
	useCreatePayment,
	useCreateTravelClaim,
	usePayments,
	useRecords,
	useTeamDetail,
	useTravelClaims,
	useVoidPayment,
	useVoidRecord,
	useVoidTravelClaim,
} from '@/lib/queries'
import type {
	BalancePeriod,
	BalanceSums,
	MemberBalance,
	OffenceRecord,
	Payment,
	PaymentMethod,
	TeamSettings,
	TravelClaim,
} from '@/lib/types'
import { formatCzk, formatDate, today } from '@/lib/types'

export function MemberPage() {
	const params = useParams()
	const membershipId = Number(params.membershipId)
	const validId = Number.isInteger(membershipId) && membershipId > 0

	const { team, seasonId, can, isSeasonClosed } = useTeam()
	const balances = useBalances(seasonId)
	const records = useRecords(validId ? seasonId : null, validId ? membershipId : undefined)
	const payments = usePayments(validId ? seasonId : null, validId ? membershipId : undefined)
	const travelClaims = useTravelClaims(validId ? seasonId : null, validId ? membershipId : undefined)
	const teamDetail = useTeamDetail(team?.id ?? null)
	const voidRecord = useVoidRecord(seasonId ?? 0)
	const voidPayment = useVoidPayment(seasonId ?? 0)
	const voidTravel = useVoidTravelClaim(seasonId ?? 0)
	const [voidingRecordId, setVoidingRecordId] = useState<number | null>(null)
	const [voidingPaymentId, setVoidingPaymentId] = useState<number | null>(null)
	const [voidingTravelId, setVoidingTravelId] = useState<number | null>(null)

	if (!validId) return <Navigate to="/dluhy" replace />

	if (seasonId === null) {
		return <NoSeasonState />
	}

	if (balances.isPending || records.isPending || payments.isPending || travelClaims.isPending) return <LoadingState />
	if (balances.error !== null) return <ErrorState error={balances.error} onRetry={() => void balances.refetch()} />
	if (records.error !== null) return <ErrorState error={records.error} onRetry={() => void records.refetch()} />
	if (payments.error !== null) return <ErrorState error={payments.error} onRetry={() => void payments.refetch()} />
	if (travelClaims.error !== null) {
		return <ErrorState error={travelClaims.error} onRetry={() => void travelClaims.refetch()} />
	}

	const member = balances.data.members.find((item) => item.membershipId === membershipId)

	if (member === undefined) return <Navigate to="/dluhy" replace />

	const canManage = can('treasurer') && !isSeasonClosed
	const groups = groupByDate(records.data.items)
	const settings = teamDetail.data?.settings
	const travelEnabled = settings?.travelEnabled === true

	return (
		<div className="flex flex-col gap-4">
			<ConfirmDialog
				open={voidingRecordId !== null}
				title="Stornovat zápis?"
				description="Zápis se nesmaže, jen se zruší — v historii zůstane dohledatelný."
				confirmLabel="Stornovat"
				danger
				onConfirm={() => {
					if (voidingRecordId !== null) voidRecord.mutate(voidingRecordId)
					setVoidingRecordId(null)
				}}
				onCancel={() => setVoidingRecordId(null)}
			/>
			<ConfirmDialog
				open={voidingPaymentId !== null}
				title="Stornovat platbu?"
				description="Platba zůstane v historii, ale znovu se přičte k dluhu."
				confirmLabel="Stornovat"
				danger
				onConfirm={() => {
					if (voidingPaymentId !== null) voidPayment.mutate(voidingPaymentId)
					setVoidingPaymentId(null)
				}}
				onCancel={() => setVoidingPaymentId(null)}
			/>
			<ConfirmDialog
				open={voidingTravelId !== null}
				title="Stornovat cesťák?"
				description="Náhrada zůstane v historii, ale přestane snižovat dluh hráče."
				confirmLabel="Stornovat"
				danger
				onConfirm={() => {
					if (voidingTravelId !== null) voidTravel.mutate(voidingTravelId)
					setVoidingTravelId(null)
				}}
				onCancel={() => setVoidingTravelId(null)}
			/>

			<Link to="/dluhy" className="text-ink-muted hover:text-ink inline-flex items-center gap-1.5 text-sm">
				<ArrowLeftIcon className="size-4" />
				Zpět na dluhy
			</Link>

			<Card className="overflow-hidden">
				<div className="flex items-center gap-4 px-4 py-4">
					<Avatar name={member.name} jerseyNumber={member.jerseyNumber} />
					<div className="min-w-0 flex-1">
						<p className="truncate text-lg font-semibold">{member.name}</p>
						<p className="text-ink-muted text-sm">{recordsLabel(member.recordCount)}</p>
					</div>
					<p className="text-3xl font-semibold">
						<Money czk={member.balanceCzk} tone="balance" />
					</p>
				</div>
				<div className="border-line/60 bg-line/60 grid grid-cols-2 gap-px border-t text-sm sm:grid-cols-4">
					<BalancePart label="Prohřešky" amount={member.offencesCzk} />
					<BalancePart label="Bonusy" amount={member.bonusesCzk} />
					<BalancePart label="Zaplaceno" amount={-member.paidCzk} />
					<BalancePart label="Cesťáky" amount={-member.travelCzk} />
				</div>
				{member.halves === null ? null : <HalvesBreakdown halves={member.halves} periods={balances.data.periods} />}
			</Card>

			{/* Vlastní konto ukazuje QR už na přehledu dluhů, tam by se zdvojilo. */}
			{member.balanceCzk > 0 && membershipId !== team?.membershipId ? (
				<PaymentQrCard seasonId={seasonId} membershipId={membershipId} title={`QR platba pro ${member.name}`} />
			) : null}

			{canManage ? (
				<div className="grid gap-4 sm:grid-cols-2">
					<PaymentForm seasonId={seasonId} member={member} />
					{travelEnabled && settings !== undefined ? (
						<TravelForm seasonId={seasonId} membershipId={membershipId} settings={settings} />
					) : null}
				</div>
			) : null}

			{payments.data.length === 0 ? null : (
				<section>
					<h2 className="text-ink-muted mb-2 text-sm font-medium">Platby</h2>
					<Card className="divide-line/50 divide-y">
						{payments.data.map((payment) => (
							<PaymentRow
								key={payment.id}
								payment={payment}
								canVoid={canManage}
								voiding={voidPayment.isPending}
								onVoid={() => setVoidingPaymentId(payment.id)}
							/>
						))}
					</Card>
				</section>
			)}

			{travelClaims.data.length === 0 ? null : (
				<section>
					<h2 className="text-ink-muted mb-2 text-sm font-medium">Cesťáky</h2>
					<Card className="divide-line/50 divide-y">
						{travelClaims.data.map((claim) => (
							<TravelRow
								key={claim.id}
								claim={claim}
								canVoid={canManage}
								voiding={voidTravel.isPending}
								onVoid={() => setVoidingTravelId(claim.id)}
							/>
						))}
					</Card>
				</section>
			)}

			{groups.length === 0 ? (
				<EmptyState title="Zatím žádný zápis" description="Hráč zatím nemá žádný prohřešek ani bonus." />
			) : (
				<div className="flex flex-col gap-4">
					{groups.map(([date, items]) => (
						<div key={date}>
							<p className="text-ink-muted mb-2 text-sm font-medium">{formatDate(date)}</p>
							<Card className="divide-line/50 divide-y">
								{items.map((record) => (
									<RecordRow
										key={record.id}
										record={record}
										canVoid={canManage}
										voiding={voidRecord.isPending}
										onVoid={() => setVoidingRecordId(record.id)}
									/>
								))}
							</Card>
						</div>
					))}
				</div>
			)}
		</div>
	)
}

function BalancePart({ label, amount }: { label: string; amount: number }) {
	return (
		<div className="bg-surface-1 px-3 py-2.5">
			<p className="text-ink-faint text-xs">{label}</p>
			<Money czk={amount} className="mt-0.5 font-medium" />
		</div>
	)
}

/**
 * Podzim a jaro vedle sebe. Je to členění podle data, ne uzávěrka — platba se
 * počítá do toho pololetí, kdy přišla, takže součet obou polovin vždycky dá
 * číslo nad tabulkou.
 */
function HalvesBreakdown({
	halves,
	periods,
}: {
	halves: { first: BalanceSums; second: BalanceSums }
	periods: BalancePeriod[]
}) {
	const columns = [
		{ sums: halves.first, period: periodByKey(periods, 'first') },
		{ sums: halves.second, period: periodByKey(periods, 'second') },
	]

	return (
		<div className="border-line/60 bg-line/60 grid grid-cols-2 gap-px border-t text-sm">
			{columns.map(({ sums, period }, index) => (
				<div key={period?.key ?? index} className="bg-surface-1 px-3 py-2.5">
					<div className="flex items-baseline justify-between gap-2">
						<p className="text-xs font-medium">{period?.label ?? '—'}</p>
						<Money czk={sums.balanceCzk} tone="balance" className="text-sm font-semibold" />
					</div>
					<p className="text-ink-faint mt-0.5 text-xs">
						{period === undefined ? null : (
							<>
								{formatDate(period.from)} – {formatDate(period.to)}
							</>
						)}
					</p>
					<dl className="text-ink-muted mt-1.5 flex flex-col gap-0.5 text-xs">
						<HalfRow label="Prohřešky" amount={sums.offencesCzk} />
						{sums.bonusesCzk === 0 ? null : <HalfRow label="Bonusy" amount={sums.bonusesCzk} />}
						<HalfRow label="Zaplaceno" amount={-sums.paidCzk} />
						{sums.travelCzk === 0 ? null : <HalfRow label="Cesťáky" amount={-sums.travelCzk} />}
					</dl>
				</div>
			))}
		</div>
	)
}

function HalfRow({ label, amount }: { label: string; amount: number }) {
	return (
		<div className="flex items-baseline justify-between gap-2">
			<dt>{label}</dt>
			<dd className="tabular">{formatCzk(amount)}</dd>
		</div>
	)
}

function PaymentForm({ seasonId, member }: { seasonId: number; member: MemberBalance }) {
	const create = useCreatePayment(seasonId)
	const [open, setOpen] = useState(false)
	const [amount, setAmount] = useState(String(Math.max(member.balanceCzk, 0)))
	const [paidOn, setPaidOn] = useState(today)
	const [method, setMethod] = useState<PaymentMethod>('cash')
	const [note, setNote] = useState('')
	const [error, setError] = useState<string | null>(null)

	async function submit(event: SubmitEvent<HTMLFormElement>) {
		event.preventDefault()
		setError(null)
		const amountCzk = Number.parseInt(amount, 10)

		if (!Number.isInteger(amountCzk) || amountCzk <= 0) {
			setError('Částka musí být celé číslo vyšší než nula.')
			return
		}

		try {
			await create.mutateAsync({
				membershipId: member.membershipId,
				amountCzk,
				paidOn,
				method,
				note: note.trim() === '' ? null : note.trim(),
			})
			setOpen(false)
			setNote('')
		} catch (cause) {
			setError(cause instanceof ApiError ? cause.message : 'Platbu se nepodařilo zapsat.')
		}
	}

	if (!open) {
		return (
			<Button
				variant="ghost"
				fullWidth
				onClick={() => {
					setAmount(String(Math.max(member.balanceCzk, 0)))
					setPaidOn(today())
					setOpen(true)
				}}
			>
				Zapsat přijatou platbu
			</Button>
		)
	}

	return (
		<Card className="p-4">
			<form className="flex flex-col gap-3" onSubmit={(event) => void submit(event)}>
				<h2 className="font-semibold">Přijatá platba</h2>
				<Field
					label="Částka (Kč)"
					type="number"
					min={1}
					step={1}
					value={amount}
					onChange={(e) => setAmount(e.target.value)}
				/>
				<Field label="Datum" type="date" value={paidOn} onChange={(e) => setPaidOn(e.target.value)} />
				<label className="flex flex-col gap-1.5">
					<span className="text-ink-muted text-sm font-medium">Způsob</span>
					<Select value={method} onChange={(event) => setMethod(toPaymentMethod(event.target.value))}>
						<option value="cash">Hotovost</option>
						<option value="transfer">Převod</option>
						<option value="qr">QR platba</option>
					</Select>
				</label>
				<Field label="Poznámka" value={note} onChange={(e) => setNote(e.target.value)} />
				{error === null ? null : <p className="text-debt text-sm">{error}</p>}
				<div className="flex justify-end gap-2">
					<Button variant="ghost" size="sm" onClick={() => setOpen(false)}>
						Zrušit
					</Button>
					<Button type="submit" size="sm" loading={create.isPending}>
						Uložit platbu
					</Button>
				</div>
			</form>
		</Card>
	)
}

function TravelForm({
	seasonId,
	membershipId,
	settings,
}: {
	seasonId: number
	membershipId: number
	settings: TeamSettings
}) {
	const create = useCreateTravelClaim(seasonId)
	const [open, setOpen] = useState(false)
	const [occurredOn, setOccurredOn] = useState(today)
	const [distance, setDistance] = useState('')
	const [note, setNote] = useState('')
	const [error, setError] = useState<string | null>(null)

	async function submit(event: SubmitEvent<HTMLFormElement>) {
		event.preventDefault()
		setError(null)
		const distanceKm = Number.parseInt(distance, 10)
		if (!Number.isInteger(distanceKm) || distanceKm <= 0) {
			setError('Vzdálenost musí být celé číslo vyšší než nula.')
			return
		}

		try {
			await create.mutateAsync({
				membershipId,
				occurredOn,
				distanceKm,
				note: note.trim() === '' ? null : note.trim(),
			})
			setOpen(false)
			setDistance('')
			setNote('')
		} catch (cause) {
			setError(cause instanceof ApiError ? cause.message : 'Cesťák se nepodařilo zapsat.')
		}
	}

	if (!open) {
		return (
			<Button variant="ghost" fullWidth onClick={() => setOpen(true)}>
				Přidat ruční cesťák
			</Button>
		)
	}

	return (
		<Card className="p-4">
			<form className="flex flex-col gap-3" onSubmit={(event) => void submit(event)}>
				<h2 className="font-semibold">Ruční cesťák</h2>
				<Field label="Datum" type="date" value={occurredOn} onChange={(e) => setOccurredOn(e.target.value)} />
				<Field
					label="Vzdálenost jedním směrem (km)"
					type="number"
					min={1}
					step={1}
					value={distance}
					onChange={(e) => setDistance(e.target.value)}
					hint={`${formatCzk(settings.travelRateCzkKm)} za km${settings.travelRoundTrip ? ', počítá se tam i zpět' : ''}`}
				/>
				<Field label="Důvod" value={note} onChange={(e) => setNote(e.target.value)} />
				{error === null ? null : <p className="text-debt text-sm">{error}</p>}
				<div className="flex justify-end gap-2">
					<Button variant="ghost" size="sm" onClick={() => setOpen(false)}>
						Zrušit
					</Button>
					<Button type="submit" size="sm" loading={create.isPending}>
						Uložit cesťák
					</Button>
				</div>
			</form>
		</Card>
	)
}

function PaymentRow({
	payment,
	canVoid,
	voiding,
	onVoid,
}: {
	payment: Payment
	canVoid: boolean
	voiding: boolean
	onVoid: () => void
}) {
	const voided = payment.voidedAt !== null

	return (
		<div className={cn('flex items-center gap-3 px-4 py-3', voided && 'opacity-50')}>
			<div className="min-w-0 flex-1">
				<p className={cn('font-medium', voided && 'line-through')}>
					{paymentMethodLabels[payment.method]}
					{voided ? <span className="text-ink-faint ml-2 text-xs font-normal">stornováno</span> : null}
				</p>
				<p className="text-ink-faint truncate text-xs">
					{formatDate(payment.paidOn)}
					{payment.note === null ? '' : ` · ${payment.note}`}
				</p>
			</div>
			<Money czk={-payment.amountCzk} className={cn(voided && 'line-through')} />
			{canVoid && !voided ? <VoidButton label="Stornovat platbu" disabled={voiding} onClick={onVoid} /> : null}
		</div>
	)
}

function TravelRow({
	claim,
	canVoid,
	voiding,
	onVoid,
}: {
	claim: TravelClaim
	canVoid: boolean
	voiding: boolean
	onVoid: () => void
}) {
	const voided = claim.voidedAt !== null

	return (
		<div className={cn('flex items-center gap-3 px-4 py-3', voided && 'opacity-50')}>
			<div className="min-w-0 flex-1">
				<p className={cn('truncate font-medium', voided && 'line-through')}>
					{claim.eventTitle ?? claim.note ?? 'Ruční cesťák'}
					{voided ? <span className="text-ink-faint ml-2 text-xs font-normal">stornováno</span> : null}
				</p>
				<p className="text-ink-faint text-xs">
					{formatDate(claim.occurredOn)} · {claim.distanceKm} km × {formatCzk(claim.rateCzkKm)}
				</p>
			</div>
			<Money czk={-claim.amountCzk} className={cn(voided && 'line-through')} />
			{canVoid && !voided ? <VoidButton label="Stornovat cesťák" disabled={voiding} onClick={onVoid} /> : null}
		</div>
	)
}

function VoidButton({ label, disabled, onClick }: { label: string; disabled: boolean; onClick: () => void }) {
	return (
		<button
			type="button"
			onClick={onClick}
			disabled={disabled}
			aria-label={label}
			className="text-ink-faint hover:bg-surface-2 hover:text-debt inline-flex size-9 shrink-0 items-center justify-center rounded-lg transition-colors disabled:cursor-not-allowed disabled:opacity-50"
		>
			<XIcon className="size-4" />
		</button>
	)
}

const paymentMethodLabels: Record<PaymentMethod, string> = {
	cash: 'Hotovost',
	transfer: 'Bankovní převod',
	qr: 'QR platba',
	gateway: 'Platební brána',
}

function toPaymentMethod(value: string): PaymentMethod {
	return value === 'transfer' || value === 'qr' ? value : 'cash'
}

interface RecordRowProps {
	record: OffenceRecord
	canVoid: boolean
	voiding: boolean
	onVoid: () => void
}

function RecordRow({ record, canVoid, voiding, onVoid }: RecordRowProps) {
	const voided = record.voidedAt !== null

	return (
		<div
			className={cn('flex items-center gap-3 px-4 py-3 first:rounded-t-2xl last:rounded-b-2xl', voided && 'opacity-50')}
		>
			<div className="min-w-0 flex-1">
				<p className={cn('font-medium', voided && 'line-through')}>{record.offenceTypeName}</p>
				{record.note === null ? null : (
					<p className={cn('truncate text-xs text-ink-faint', voided && 'line-through')}>{record.note}</p>
				)}
			</div>

			<Money czk={record.amountCzk} className={cn(voided && 'line-through')} />

			{canVoid && !voided ? (
				<button
					type="button"
					onClick={onVoid}
					disabled={voiding}
					aria-label="Stornovat zápis"
					className="text-ink-faint hover:bg-surface-2 hover:text-debt inline-flex size-9 shrink-0 items-center justify-center rounded-lg transition-colors disabled:cursor-not-allowed disabled:opacity-50"
				>
					<XIcon className="size-4" />
				</button>
			) : null}
		</div>
	)
}

/** Zápisy seskupené podle data prohřešku, od nejnovějšího. */
function groupByDate(items: OffenceRecord[]): Array<[string, OffenceRecord[]]> {
	const groups = new Map<string, OffenceRecord[]>()

	for (const item of items) {
		const existing = groups.get(item.occurredOn)
		if (existing === undefined) {
			groups.set(item.occurredOn, [item])
		} else {
			existing.push(item)
		}
	}

	return [...groups.entries()].toSorted(([a], [b]) => (a < b ? 1 : a > b ? -1 : 0))
}
