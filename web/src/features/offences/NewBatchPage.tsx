import { useEffect, useMemo, useRef, useState } from 'react'
import { useBlocker, useSearchParams } from 'react-router'

import { useTeam } from '@/app/team'
import { NoSeasonState } from '@/components/NoSeasonState'
import { Avatar } from '@/components/ui/Avatar'
import { Button } from '@/components/ui/Button'
import { Card } from '@/components/ui/Card'
import { ConfirmDialog } from '@/components/ui/ConfirmDialog'
import { ChevronDownIcon, ChevronRightIcon, SearchIcon } from '@/components/ui/icons'
import { Money } from '@/components/ui/Money'
import { Select } from '@/components/ui/Select'
import { EmptyState, ErrorState, LoadingState } from '@/components/ui/States'
import { formatEventTime } from '@/features/events/events'
import { BatchResult, BatchReview } from '@/features/offences/BatchReview'
import type { Draft, DraftSummary } from '@/features/offences/draft'
import {
	changeCount,
	draftCount,
	emptyDraft,
	isDraftEmpty,
	suggestFromAttendance,
	summarizeDraft,
	toBatchInput,
} from '@/features/offences/draft'
import { OffencePicker } from '@/features/offences/OffencePicker'
import { ApiError } from '@/lib/api'
import { cn } from '@/lib/cn'
import { players, records } from '@/lib/plural'
import { useBalances, useCreateBatch, useEvent, useEvents, useOffenceTypes } from '@/lib/queries'
import { useScrollTopOnChange } from '@/lib/scroll'
import { matches } from '@/lib/text'
import type { BatchSummary, MemberBalance, OffenceType, PriceChange } from '@/lib/types'
import { formatCzk, today } from '@/lib/types'

type Step = 'compose' | 'review' | 'done'

// Nejdřív člověk, pak prohřešky — kopíruje postup v reálnosti
export function NewBatchPage() {
	const { seasonId, season, isSeasonClosed, can } = useTeam()
	const balances = useBalances(seasonId)
	const types = useOffenceTypes(seasonId)
	const createBatch = useCreateBatch(seasonId ?? 0)

	// Akce může přijít z detailu („Zapsat prohřešky") nebo se vybere tady.
	const [params] = useSearchParams()
	const [eventId, setEventId] = useState<number | null>(() => {
		const raw = Number(params.get('akce'))

		return Number.isInteger(raw) && raw > 0 ? raw : null
	})

	const [draft, setDraft] = useState<Draft>(emptyDraft)
	const [openMemberId, setOpenMemberId] = useState<number | null>(null)
	const [occurredOn, setOccurredOn] = useState(today)
	const [title, setTitle] = useState('')
	const [search, setSearch] = useState('')
	const [step, setStep] = useState<Step>('compose')
	const [result, setResult] = useState<BatchSummary | null>(null)
	const [priceChanges, setPriceChanges] = useState<PriceChange[] | null>(null)
	const [submitError, setSubmitError] = useState<string | null>(null)

	// clientUuid se drží přes pokusy — serverová idempotence
	const clientUuid = useRef(crypto.randomUUID())

	const activeTypes = useMemo(
		() =>
			(types.data ?? [])
				.filter((type) => type.archivedAt === null)
				.toSorted((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name, 'cs')),
		[types.data],
	)

	// Jen hráči na soupisce — dluh po ostatních zůstává vidět
	const members = useMemo(() => (balances.data?.members ?? []).filter((member) => member.onRoster), [balances.data])

	const visibleMembers = useMemo(() => members.filter((member) => matches(member.name, search)), [members, search])
	const summary = useMemo(() => summarizeDraft(draft, members, activeTypes), [draft, members, activeTypes])

	// Rozepsaná dávka jen v paměti — po odeslání je na serveru
	const hasDraft = !isDraftEmpty(draft) && step !== 'done'

	const events = useEvents(seasonId)
	const eventDetail = useEvent(eventId)

	// Nabízí se proběhlé akce od nejnovější — zapisuje se po tréninku, ne před ním.
	const pastEvents = useMemo(
		() => (events.data ?? []).filter((event) => event.started && event.status !== 'cancelled').toReversed(),
		[events.data],
	)

	// Návrh se jen nabídne, nevloží se sám — ceny tréninku a zápasu se liší i o stovky, tiché doplnění by bylo riskantní.
	const [suggestionUsed, setSuggestionUsed] = useState(false)

	const suggestion = useMemo(() => {
		const detail = eventDetail.data

		if (detail === undefined || detail.event.id !== eventId) return emptyDraft

		return suggestFromAttendance(detail.participants, activeTypes, detail.event.type)
	}, [eventDetail.data, eventId, activeTypes])

	const suggestionSummary = useMemo(
		() => summarizeDraft(suggestion, members, activeTypes),
		[suggestion, members, activeTypes],
	)

	function applySuggestion() {
		setDraft((current) => {
			const merged = { ...current }

			// Přičítá se k tomu, co už je naklikané — nic se nepřepisuje.
			for (const [key, count] of Object.entries(suggestion)) {
				merged[key] = (merged[key] ?? 0) + count
			}

			return merged
		})
		setSuggestionUsed(true)
	}

	// Souhrn i potvrzení jsou jiná obrazovka, jen beze změny adresy.
	useScrollTopOnChange(step)

	const blocker = useBlocker(
		({ currentLocation, nextLocation }) => hasDraft && currentLocation.pathname !== nextLocation.pathname,
	)

	// beforeunload — jediný způsob na odchod, hláška je od prohlížeče
	useEffect(() => {
		if (!hasDraft) return

		const warn = (event: BeforeUnloadEvent) => event.preventDefault()
		window.addEventListener('beforeunload', warn)

		return () => window.removeEventListener('beforeunload', warn)
	}, [hasDraft])

	if (seasonId === null) {
		return <NoSeasonState />
	}

	if (!can('treasurer')) {
		return (
			<EmptyState
				title="Zapisovat může jen pínař"
				description="Když máš pocit, že ti něco chybí nebo přebývá, ozvi se tomu, kdo pínu vede."
			/>
		)
	}

	// Uzavřenou sezónu řekneme dopředu — lepší než odmítnutí při odeslání
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
		setEventId(null)
		setSuggestionUsed(false)
		clientUuid.current = crypto.randomUUID()
		setStep('compose')
	}

	/** Přepnutí akce zahodí předchozí návrh, ať se dva tréninky nesmíchají. */
	function chooseEvent(next: number | null) {
		setEventId(next)
		setSuggestionUsed(false)

		if (next === null) return

		const chosen = pastEvents.find((event) => event.id === next)
		if (chosen !== undefined) setOccurredOn(chosen.startsAt.slice(0, 10))
	}

	async function submit() {
		setSubmitError(null)

		try {
			const created = await createBatch.mutateAsync(
				toBatchInput(summary, {
					clientUuid: clientUuid.current,
					occurredOn,
					title: title.trim() === '' ? null : title.trim(),
					eventId,
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
				<Card className="flex flex-col gap-3 p-4">
					{pastEvents.length === 0 ? null : (
						<label className="flex flex-col gap-1.5">
							<span className="text-ink-muted text-sm font-medium">Akce (nepovinná)</span>
							<Select
								value={eventId ?? ''}
								onChange={(event) => chooseEvent(event.target.value === '' ? null : Number(event.target.value))}
							>
								<option value="">Bez akce</option>
								{pastEvents.map((event) => (
									<option key={event.id} value={event.id}>
										{formatEventTime(event.startsAt)} — {event.title}
									</option>
								))}
							</Select>
							{eventId === null ? (
								<span className="text-ink-faint text-xs">Podle vybrané akce nabídneme zápis za ty, kdo chyběli.</span>
							) : null}
						</label>
					)}

					{eventId === null ? null : (
						<SuggestionPrompt
							summary={suggestionSummary}
							used={suggestionUsed}
							loading={eventDetail.isPending}
							onApply={applySuggestion}
						/>
					)}

					<div className="flex gap-3">
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
					</div>
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

/** Tlačítko schválně, ne tiché doplnění — rozdíl mezi omluveným tréninkem a zápasem bývá stovky korun, pínař musí vidět, co se chystá. */
function SuggestionPrompt({
	summary,
	used,
	loading,
	onApply,
}: {
	summary: DraftSummary
	used: boolean
	loading: boolean
	onApply: () => void
}) {
	if (loading) {
		return <p className="text-ink-faint px-1 text-sm">Načítám docházku…</p>
	}

	if (summary.recordCount === 0) {
		return (
			<p className="text-ink-faint px-1 text-sm">
				Podle docházky není co navrhnout. Buď dorazili všichni, nebo v sazebníku není označené, čím se absence zapisuje.
			</p>
		)
	}

	if (used) {
		return <p className="text-ink-faint px-1 text-sm">Návrh z docházky je doplněný — dál to upravte, jak chcete.</p>
	}

	const names = summary.members.map((member) => member.name)

	return (
		<div className="border-line bg-surface-2 flex flex-col gap-2 rounded-xl border p-3">
			<p className="text-sm font-medium">Podle docházky chyběli: {names.join(', ')}</p>
			<ul className="text-ink-muted flex flex-col gap-0.5 text-sm">
				{groupSuggestion(summary).map((line) => (
					<li key={line.name}>
						{line.count}× {line.name} — <Money czk={line.totalCzk} />
					</li>
				))}
			</ul>
			<div className="flex flex-wrap items-center gap-3">
				<Button variant="accent" onClick={onApply}>
					Doplnit do zápisu
				</Button>
				<span className="text-ink-faint text-sm">
					celkem <Money czk={summary.totalCzk} />
				</span>
			</div>
		</div>
	)
}

/** Návrh po prohřešcích, ne po lidech — jsou to dvě položky, ne dvacet řádků. */
function groupSuggestion(summary: DraftSummary): Array<{ name: string; count: number; totalCzk: number }> {
	const byName = new Map<string, { name: string; count: number; totalCzk: number }>()

	for (const member of summary.members) {
		for (const item of member.items) {
			const line = byName.get(item.name) ?? { name: item.name, count: 0, totalCzk: 0 }

			line.count += item.count
			line.totalCzk += item.totalCzk
			byName.set(item.name, line)
		}
	}

	return [...byName.values()]
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

/** Otevřený je vždy nejvýš jeden — dva rozbalené seznamy najednou by byly nepřehledná zeď. */
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
