import { useEffect, useMemo, useRef, useState } from 'react'
import { useBlocker } from 'react-router'

import { useTeam } from '@/app/team'
import { Avatar } from '@/components/ui/Avatar'
import { Button } from '@/components/ui/Button'
import { Card } from '@/components/ui/Card'
import { ConfirmDialog } from '@/components/ui/ConfirmDialog'
import { ChevronDownIcon, ChevronRightIcon, SearchIcon } from '@/components/ui/icons'
import { Money } from '@/components/ui/Money'
import { EmptyState, ErrorState, LoadingState } from '@/components/ui/States'
import { BatchResult, BatchReview } from '@/features/offences/BatchReview'
import type { Draft } from '@/features/offences/draft'
import {
	changeCount,
	draftCount,
	emptyDraft,
	isDraftEmpty,
	summarizeDraft,
	toBatchInput,
} from '@/features/offences/draft'
import { OffencePicker } from '@/features/offences/OffencePicker'
import { ApiError } from '@/lib/api'
import { cn } from '@/lib/cn'
import { players, records } from '@/lib/plural'
import { useBalances, useCreateBatch, useOffenceTypes } from '@/lib/queries'
import { matches } from '@/lib/text'
import type { BatchSummary, MemberBalance, OffenceType, PriceChange } from '@/lib/types'
import { formatCzk, today } from '@/lib/types'

type Step = 'compose' | 'review' | 'done'

/**
 * Zápis prohřešků — nejpoužívanější obrazovka aplikace.
 *
 * Postup kopíruje to, jak se to dělá doopravdy: pínař obchází kabinu a u každého
 * se ptá, co provedl. Proto se nejdřív vybere člověk a teprve pod ním se
 * naklikají prohřešky. Opačné pořadí (vyber prohřešek, ťukej na lidi) je rychlejší
 * jen u hromadných věcí typu pozdní příchod, ale nutí přeskakovat sem a tam.
 */
export function NewBatchPage() {
	const { seasonId, season, isSeasonClosed, can } = useTeam()
	const balances = useBalances(seasonId)
	const types = useOffenceTypes(seasonId)
	const createBatch = useCreateBatch(seasonId ?? 0)

	const [draft, setDraft] = useState<Draft>(emptyDraft)
	const [openMemberId, setOpenMemberId] = useState<number | null>(null)
	const [occurredOn, setOccurredOn] = useState(today)
	const [title, setTitle] = useState('')
	const [search, setSearch] = useState('')
	const [step, setStep] = useState<Step>('compose')
	const [result, setResult] = useState<BatchSummary | null>(null)
	const [priceChanges, setPriceChanges] = useState<PriceChange[] | null>(null)
	const [submitError, setSubmitError] = useState<string | null>(null)

	/**
	 * Identifikátor dávky. Drží se přes všechny pokusy o odeslání, aby opakování
	 * po výpadku sítě nezaložilo druhou dávku — server ho používá k idempotenci.
	 * Nový vzniká až po úspěšném zápisu.
	 */
	const clientUuid = useRef(crypto.randomUUID())

	const activeTypes = useMemo(
		() =>
			(types.data ?? [])
				.filter((type) => type.archivedAt === null)
				.toSorted((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name, 'cs')),
		[types.data],
	)

	// Kdo v sezóně nehraje, tomu se nezapisuje. Dluh po něm ale zůstává,
	// proto je pořád vidět v přehledu — jen ne tady.
	const members = useMemo(() => (balances.data?.members ?? []).filter((member) => member.onRoster), [balances.data])

	const visibleMembers = useMemo(() => members.filter((member) => matches(member.name, search)), [members, search])
	const summary = useMemo(() => summarizeDraft(draft, members, activeTypes), [draft, members, activeTypes])

	/**
	 * Rozepsaná dávka žije jen v paměti. Odchod na jinou obrazovku nebo obnovení
	 * stránky ji zahodí, a to může být hodina obcházení kabiny — proto se ptáme.
	 * Po odeslání už je co chránit na serveru, takže se hlídání vypne.
	 */
	const hasDraft = !isDraftEmpty(draft) && step !== 'done'

	const blocker = useBlocker(
		({ currentLocation, nextLocation }) => hasDraft && currentLocation.pathname !== nextLocation.pathname,
	)

	// Obnovení stránky a zavření panelu umí zadržet jen prohlížeč, vlastním
	// dialogem to nejde. Hláška je jeho, ovlivnit se nedá.
	useEffect(() => {
		if (!hasDraft) return

		const warn = (event: BeforeUnloadEvent) => event.preventDefault()
		window.addEventListener('beforeunload', warn)

		return () => window.removeEventListener('beforeunload', warn)
	}, [hasDraft])

	if (seasonId === null) {
		return (
			<EmptyState
				title="Tým nemá rozjetou sezónu"
				description="Sezónu založí admin družstva. Bez ní není kam prohřešky zapisovat."
			/>
		)
	}

	if (!can('treasurer')) {
		return (
			<EmptyState
				title="Zapisovat může jen pínař"
				description="Když máš pocit, že ti něco chybí nebo přebývá, ozvi se tomu, kdo pínu vede."
			/>
		)
	}

	// Uzavřenou sezónu server odmítne až při odeslání. Říct to rovnou je slušnější
	// než nechat pínaře naklikat celý trénink a pak mu to shodit.
	if (isSeasonClosed) {
		return (
			<EmptyState
				title={`Sezóna ${season?.name ?? ''} je uzavřená`}
				description="Do uzavřené sezóny se už nezapisuje. Přepni se v hlavičce na probíhající sezónu."
			/>
		)
	}

	if (balances.isPending || types.isPending) return <LoadingState />
	if (balances.error !== null) return <ErrorState error={balances.error} onRetry={() => void balances.refetch()} />
	if (types.error !== null) return <ErrorState error={types.error} onRetry={() => void types.refetch()} />

	function reset() {
		setDraft(emptyDraft)
		setTitle('')
		setSearch('')
		setOpenMemberId(null)
		setResult(null)
		setPriceChanges(null)
		setSubmitError(null)
		setOccurredOn(today())
		clientUuid.current = crypto.randomUUID()
		setStep('compose')
	}

	async function submit() {
		setSubmitError(null)

		try {
			const created = await createBatch.mutateAsync(
				toBatchInput(summary, {
					clientUuid: clientUuid.current,
					occurredOn,
					title: title.trim() === '' ? null : title.trim(),
				}),
			)

			setResult(created)
			setStep('done')
		} catch (cause) {
			if (cause instanceof ApiError && cause.code === 'PRICE_CHANGED') {
				// Souhrn se přepočítá sám, jakmile dorazí nový sazebník; pínař jen
				// uvidí, co se změnilo, a potvrdí znovu.
				setPriceChanges(readPriceChanges(cause))
				void types.refetch()

				return
			}

			setSubmitError(cause instanceof ApiError ? cause.message : 'Zápis se nepodařilo odeslat. Zkontrolujte připojení.')
		}
	}

	if (step === 'done' && result !== null) {
		return <BatchResult result={result} onAnother={reset} />
	}

	if (activeTypes.length === 0) {
		return (
			<EmptyState title="Sazebník je prázdný" description="Nejdřív je potřeba nastavit, co se zapisuje a za kolik." />
		)
	}

	const leaveDialog = (
		<ConfirmDialog
			open={blocker.state === 'blocked'}
			title="Zahodit rozepsaný zápis?"
			description="Ještě nic není odeslané. Když odejdeš, naklikané prohřešky se ztratí."
			confirmLabel="Zahodit"
			cancelLabel="Zůstat"
			danger
			onConfirm={() => blocker.proceed?.()}
			onCancel={() => blocker.reset?.()}
		/>
	)

	if (step === 'review') {
		return (
			<>
				<BatchReview
					summary={summary}
					occurredOn={occurredOn}
					title={title.trim() === '' ? null : title.trim()}
					priceChanges={priceChanges}
					submitting={createBatch.isPending}
					error={submitError}
					onBack={() => setStep('compose')}
					onConfirm={() => void submit()}
				/>
				{leaveDialog}
			</>
		)
	}

	return (
		<>
			<div className="flex flex-col gap-4">
				<Card className="flex gap-3 p-4">
					<label className="flex flex-1 flex-col gap-1.5">
						<span className="text-ink-muted text-sm font-medium">Datum</span>
						<input
							type="date"
							value={occurredOn}
							onChange={(event) => setOccurredOn(event.target.value)}
							className="border-line bg-surface-2 text-ink rounded-xl border px-3 py-2.5 text-base"
						/>
					</label>
					<label className="flex flex-2 flex-col gap-1.5">
						<span className="text-ink-muted text-sm font-medium">Popis (nepovinný)</span>
						<input
							type="text"
							value={title}
							onChange={(event) => setTitle(event.target.value)}
							placeholder="Trénink, zápas s Benátkami…"
							maxLength={120}
							className="border-line bg-surface-2 text-ink placeholder:text-ink-faint rounded-xl border px-3 py-2.5 text-base"
						/>
					</label>
				</Card>

				<div className="flex items-center justify-between gap-3">
					<h1 className="text-lg font-semibold">Kdo co provedl</h1>
					<div className="relative">
						<SearchIcon className="text-ink-faint absolute top-1/2 left-2 size-4 -translate-y-1/2" />
						<input
							type="search"
							value={search}
							onChange={(event) => setSearch(event.target.value)}
							placeholder="Hledat hráče"
							aria-label="Hledat hráče"
							className="border-line bg-surface-2 placeholder:text-ink-faint w-40 rounded-lg border py-1.5 pr-2 pl-8 text-sm"
						/>
					</div>
				</div>

				{visibleMembers.length === 0 ? (
					<EmptyState
						title="Nikdo takový tu není"
						description="Na soupisce téhle sezóny takový hráč není. Zkuste jiné jméno."
					/>
				) : (
					<Card className="divide-line/50 divide-y">
						{visibleMembers.map((member) => (
							<MemberComposeRow
								key={member.membershipId}
								member={member}
								types={activeTypes}
								draft={draft}
								open={openMemberId === member.membershipId}
								onToggle={() =>
									setOpenMemberId((current) => (current === member.membershipId ? null : member.membershipId))
								}
								onAdd={(typeId) => setDraft((current) => changeCount(current, member.membershipId, typeId, 1))}
								onRemove={(typeId) => setDraft((current) => changeCount(current, member.membershipId, typeId, -1))}
							/>
						))}
					</Card>
				)}

				{isDraftEmpty(draft) ? null : (
					<div className="sticky bottom-24 z-10 md:bottom-4">
						<Card className="border-line bg-surface-2/95 flex items-center gap-3 p-3 backdrop-blur">
							<div className="min-w-0 flex-1">
								<p className="text-ink-faint text-xs">
									{records(summary.recordCount)} · {players(summary.members.length)}
								</p>
								<p className="tabular text-lg font-semibold">{formatCzk(summary.totalCzk)}</p>
							</div>
							<Button variant="accent" size="lg" onClick={() => setStep('review')}>
								Souhrn
								<ChevronRightIcon className="size-5" />
							</Button>
						</Card>
					</div>
				)}
			</div>
			{leaveDialog}
		</>
	)
}

interface MemberComposeRowProps {
	member: MemberBalance
	types: OffenceType[]
	draft: Draft
	open: boolean
	onToggle: () => void
	onAdd: (offenceTypeId: number) => void
	onRemove: (offenceTypeId: number) => void
}

/**
 * Řádek hráče, který se rozbalí do sazebníku. Otevřený je vždycky nejvýš jeden —
 * pínař řeší jednoho člověka a pak jde dál, a dva otevřené seznamy by z obrazovky
 * udělaly nepřehlednou zeď.
 */
function MemberComposeRow({ member, types, draft, open, onToggle, onAdd, onRemove }: MemberComposeRowProps) {
	const picked = types
		.map((type) => ({ type, count: draftCount(draft, member.membershipId, type.id) }))
		.filter((entry) => entry.count > 0)

	const total = picked.reduce((sum, entry) => sum + entry.type.amountCzk * entry.count, 0)

	return (
		<div className={cn(picked.length > 0 && 'bg-brand-600/10')}>
			<button
				type="button"
				onClick={onToggle}
				aria-expanded={open}
				className="flex w-full items-center gap-3 px-4 py-3 text-left"
			>
				<Avatar name={member.name} jerseyNumber={member.jerseyNumber} />

				<span className="min-w-0 flex-1">
					<span className="block truncate font-medium">{member.name}</span>
					{picked.length === 0 ? (
						<span className="text-ink-faint block text-xs">dluží {formatCzk(member.balanceCzk)}</span>
					) : (
						<span className="mt-1 flex flex-wrap gap-1">
							{picked.map((entry) => (
								<span key={entry.type.id} className="bg-surface-3 text-ink-muted rounded-md px-1.5 py-0.5 text-xs">
									{entry.type.name}
									{entry.count > 1 ? ` ×${entry.count}` : ''}
								</span>
							))}
						</span>
					)}
				</span>

				{picked.length > 0 ? <Money czk={total} className="font-semibold" /> : null}
				<ChevronDownIcon className={cn('text-ink-faint size-5 shrink-0 transition-transform', open && 'rotate-180')} />
			</button>

			{open ? (
				<div className="border-line/50 border-t px-4 py-3">
					<OffencePicker
						types={types}
						countOf={(typeId) => draftCount(draft, member.membershipId, typeId)}
						onAdd={onAdd}
						onRemove={onRemove}
					/>
					<div className="mt-3 flex justify-end">
						<Button size="sm" variant="ghost" onClick={onToggle}>
							Hotovo
						</Button>
					</div>
				</div>
			) : null}
		</div>
	)
}

/** Podrobnosti u 409 chodí jako `details.changes`; tvar ověřujeme, ať se UI nerozbije. */
function readPriceChanges(error: ApiError): PriceChange[] | null {
	const changes = error.details?.['changes']

	return Array.isArray(changes) ? (changes as PriceChange[]) : null
}
