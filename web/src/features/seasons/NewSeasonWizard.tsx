import type { SubmitEvent } from 'react'
import { useEffect, useRef, useState } from 'react'
import { Link, Navigate, useNavigate } from 'react-router'

import { useTeam } from '@/app/team'
import { Button } from '@/components/ui/Button'
import { Card, CardHeader } from '@/components/ui/Card'
import { Field } from '@/components/ui/Field'
import { ArrowLeftIcon, CheckIcon } from '@/components/ui/icons'
import { Money } from '@/components/ui/Money'
import { Select } from '@/components/ui/Select'
import { EmptyState, LoadingState } from '@/components/ui/States'
import { ApiError } from '@/lib/api'
import { cn } from '@/lib/cn'
import { players } from '@/lib/plural'
import {
	useCopyOffenceTypes,
	useCreateSeason,
	useOffenceTypes,
	useRoster,
	useSaveRoster,
	useTeamMembers,
} from '@/lib/queries'
import { useScrollTopOnChange } from '@/lib/scroll'
import type { Season } from '@/lib/types'
import { roleLabels, today } from '@/lib/types'

import { suggestSeason } from './suggest'

type Step = 'basics' | 'pricelist' | 'roster' | 'done'

const stepTitles: Record<Step, string> = {
	basics: 'Období',
	pricelist: 'Sazebník',
	roster: 'Soupiska',
	done: 'Hotovo',
}

// Průvodce předvyplní sazebník i soupisku z minulé sezóny
export function NewSeasonWizard() {
	const { team, seasons, selectSeason, can } = useTeam()
	const navigate = useNavigate()

	const previous = seasons[0] ?? null
	const [step, setStep] = useState<Step>('basics')

	// Každý krok je jiná obrazovka, jen beze změny adresy.
	useScrollTopOnChange(step)

	const suggestion = useState(() => suggestSeason(previous, today()))[0]
	const [name, setName] = useState(suggestion.name)
	const [startsOn, setStartsOn] = useState(suggestion.startsOn)
	const [endsOn, setEndsOn] = useState(suggestion.endsOn)

	const [sourceSeasonId, setSourceSeasonId] = useState<number | null>(previous?.id ?? null)
	const [prices, setPrices] = useState<Record<number, string>>({})
	const [rosterIds, setRosterIds] = useState<Set<number>>(new Set())

	const [created, setCreated] = useState<Season | null>(null)
	const [error, setError] = useState<string | null>(null)
	const [saving, setSaving] = useState(false)

	const sourceTypes = useOffenceTypes(sourceSeasonId)
	const sourceRoster = useRoster(sourceSeasonId)
	const members = useTeamMembers(team?.id ?? null)

	const createSeason = useCreateSeason(team?.id ?? 0)
	const copyTypes = useCopyOffenceTypes()
	const saveRoster = useSaveRoster(team?.id ?? 0)

	// Pojistka — bez ní by každé načtení přepsalo, co admin naklikal
	const filledFrom = useRef<number | null>(null)

	useEffect(() => {
		if (sourceSeasonId === null || filledFrom.current === sourceSeasonId) return
		if (sourceTypes.data === undefined || sourceRoster.data === undefined) return

		filledFrom.current = sourceSeasonId
		setPrices(Object.fromEntries(sourceTypes.data.map((type) => [type.id, String(type.amountCzk)])))
		setRosterIds(new Set(sourceRoster.data.map((entry) => entry.membershipId)))
	}, [sourceSeasonId, sourceTypes.data, sourceRoster.data])

	if (team === null) return <Navigate to="/dluhy" replace />

	if (!can('admin')) {
		return (
			<EmptyState
				title="Sezóny zakládá admin"
				description="Novou sezónu i soupisku má na starosti admin družstva. Ozvi se mu, ať ji založí."
			/>
		)
	}

	async function submit() {
		if (team === null) return

		setSaving(true)
		setError(null)

		try {
			const season = await createSeason.mutateAsync({ name: name.trim(), startsOn, endsOn })

			const items = Object.entries(prices)
				.map(([id, amount]) => ({ offenceTypeId: Number(id), amountCzk: Number.parseInt(amount, 10) }))
				.filter((item) => Number.isInteger(item.amountCzk))

			try {
				if (items.length > 0 && sourceSeasonId !== null) {
					await copyTypes.mutateAsync({ targetSeasonId: season.id, sourceSeasonId, items })
				}

				if (rosterIds.size > 0) {
					await saveRoster.mutateAsync({ seasonId: season.id, membershipIds: [...rosterIds] })
				}
			} catch (cause) {
				// Sezóna už existuje, spadlo až přebírání. Říct to naplno je lepší
				// než tvrdit, že se nepovedlo nic — admin by ji zakládal podruhé.
				setError(
					`Sezóna ${season.name} vznikla, ale nepodařilo se dokončit převzetí: ${
						cause instanceof ApiError ? cause.message : 'zkontrolujte připojení'
					}. Doplňte to prosím v přehledu sezón.`,
				)
				setSaving(false)

				return
			}

			selectSeason(season.id)
			setCreated(season)
			setStep('done')
		} catch (cause) {
			setError(cause instanceof ApiError ? cause.message : 'Sezónu se nepodařilo založit. Zkuste to znovu.')
		} finally {
			setSaving(false)
		}
	}

	if (step === 'done' && created !== null) {
		return (
			<div className="flex flex-col gap-4">
				<Card className="flex flex-col items-center gap-3 px-6 py-8 text-center">
					<span className="bg-bonus-500/20 text-bonus grid size-14 place-items-center rounded-full">
						<CheckIcon className="size-7" />
					</span>
					<div>
						<h1 className="text-lg font-semibold">Sezóna {created.name} je založená</h1>
						<p className="text-ink-muted mt-1 text-sm">
							Převzato {Object.keys(prices).length} položek sazebníku, na soupisce {players(rosterIds.size)}.
						</p>
					</div>
					<p className="text-ink-faint text-sm">Aplikace je přepnutá na novou sezónu, můžete začít zapisovat.</p>
				</Card>

				<div className="flex gap-3">
					<Button variant="accent" size="lg" fullWidth onClick={() => void navigate('/zapsat')}>
						Zapsat prohřešky
					</Button>
					<Button variant="ghost" size="lg" fullWidth onClick={() => void navigate('/sezony')}>
						Přehled sezón
					</Button>
				</div>
			</div>
		)
	}

	const stepOrder: Step[] = ['basics', 'pricelist', 'roster']
	const stepIndex = stepOrder.indexOf(step)
	const canContinue = name.trim() !== '' && startsOn !== '' && endsOn !== '' && startsOn < endsOn

	return (
		<div className="flex flex-col gap-4">
			<div className="flex items-center gap-2">
				<Link to="/sezony" className="text-ink-muted hover:text-ink -ml-2 inline-flex items-center gap-1 px-2 text-sm">
					<ArrowLeftIcon className="size-5" />
					Zpět
				</Link>
			</div>

			<div>
				<h1 className="text-lg font-semibold">Nová sezóna</h1>
				<p className="text-ink-muted text-sm">
					Krok {stepIndex + 1} ze 3 · {stepTitles[step]}
				</p>
			</div>

			{step === 'basics' ? (
				<Card className="p-4">
					<form
						className="flex flex-col gap-4"
						onSubmit={(event: SubmitEvent<HTMLFormElement>) => {
							event.preventDefault()
							setStep('pricelist')
						}}
					>
						<Field
							label="Název sezóny"
							value={name}
							onChange={(event) => setName(event.target.value)}
							hint={previous === null ? undefined : `Předchozí sezóna se jmenuje ${previous.name}.`}
							maxLength={40}
							required
						/>
						<div className="flex gap-3">
							<div className="flex-1">
								<Field
									label="Začátek"
									type="date"
									value={startsOn}
									onChange={(event) => setStartsOn(event.target.value)}
									required
								/>
							</div>
							<div className="flex-1">
								<Field
									label="Konec"
									type="date"
									value={endsOn}
									onChange={(event) => setEndsOn(event.target.value)}
									error={
										startsOn !== '' && endsOn !== '' && startsOn >= endsOn ? 'Konec musí být po začátku.' : undefined
									}
									required
								/>
							</div>
						</div>

						<p className="text-ink-faint text-xs">
							Nová sezóna se rovnou stane aktuální — do té předchozí se přestane zapisovat.
						</p>

						<div className="flex justify-end">
							<Button type="submit" variant="accent" disabled={!canContinue}>
								Pokračovat
							</Button>
						</div>
					</form>
				</Card>
			) : null}

			{step === 'pricelist' ? (
				<Card>
					<CardHeader
						title="Převzít sazebník"
						subtitle="Ceny se dají rovnou upravit. Historii to nezmění — zapsané prohřešky si drží cenu z doby zápisu."
					/>

					{seasons.length > 1 ? (
						<label className="border-line/60 flex items-center gap-3 border-b px-4 py-3 text-sm">
							<span className="text-ink-muted">Ze sezóny</span>
							<Select
								value={sourceSeasonId ?? ''}
								onChange={(event) => {
									setSourceSeasonId(event.target.value === '' ? null : Number(event.target.value))
									filledFrom.current = null
								}}
							>
								<option value="">nepřebírat</option>
								{seasons.map((item) => (
									<option key={item.id} value={item.id}>
										{item.name}
									</option>
								))}
							</Select>
						</label>
					) : null}

					{sourceSeasonId === null ? (
						<p className="text-ink-muted px-4 py-6 text-sm">
							Sazebník se nepřevezme, položky se přidají ručně v sekci Sazebník.
						</p>
					) : sourceTypes.isPending ? (
						<LoadingState />
					) : (
						<>
							<div className="border-line/60 text-ink-muted flex items-center justify-between border-b px-4 py-2 text-xs">
								<span>
									Vybráno {Object.keys(prices).length} z {sourceTypes.data?.length ?? 0}
								</span>
								<button
									type="button"
									className="text-accent min-h-0 py-1"
									onClick={() =>
										setPrices(
											Object.keys(prices).length > 0
												? {}
												: Object.fromEntries((sourceTypes.data ?? []).map((t) => [t.id, String(t.amountCzk)])),
										)
									}
								>
									{Object.keys(prices).length > 0 ? 'Odznačit vše' : 'Označit vše'}
								</button>
							</div>

							<ul className="divide-line/50 max-h-104 divide-y overflow-y-auto">
								{(sourceTypes.data ?? []).map((type) => {
									const selected = prices[type.id] !== undefined

									return (
										<li key={type.id} className="flex items-center gap-3 px-4 py-2">
											<input
												type="checkbox"
												checked={selected}
												aria-label={type.name}
												onChange={() =>
													setPrices((current) => {
														const next = { ...current }
														if (selected) delete next[type.id]
														else next[type.id] = String(type.amountCzk)

														return next
													})
												}
												className="accent-brand-600 size-5 min-h-0 shrink-0"
											/>
											<span className={cn('min-w-0 flex-1 truncate text-sm', selected ? 'text-ink' : 'text-ink-faint')}>
												{type.name}
											</span>
											{selected ? (
												<input
													type="number"
													step={1}
													value={prices[type.id] ?? ''}
													aria-label={`Cena za ${type.name}`}
													onChange={(event) => setPrices((current) => ({ ...current, [type.id]: event.target.value }))}
													className="border-line bg-surface-2 tabular text-ink min-h-0 w-24 rounded-lg border px-2 py-1 text-right text-sm"
												/>
											) : (
												<Money czk={type.amountCzk} className="text-sm opacity-50" />
											)}
										</li>
									)
								})}
							</ul>
						</>
					)}

					<div className="border-line/60 flex justify-between gap-3 border-t px-4 py-3">
						<Button variant="ghost" onClick={() => setStep('basics')}>
							Zpět
						</Button>
						<Button variant="accent" onClick={() => setStep('roster')}>
							Pokračovat
						</Button>
					</div>
				</Card>
			) : null}

			{step === 'roster' ? (
				<Card>
					<CardHeader
						title="Kdo pokračuje"
						subtitle="Zaškrtnutí jsou lidé z minulé sezóny. Odškrtněte, kdo skončil, a přidejte nové."
					/>

					{members.isPending ? (
						<LoadingState />
					) : (
						<>
							<div className="border-line/60 text-ink-muted border-b px-4 py-2 text-xs">
								Na soupisce {players(rosterIds.size)}
							</div>

							<ul className="divide-line/50 max-h-104 divide-y overflow-y-auto">
								{(members.data ?? [])
									.filter((member) => member.status !== 'left' || rosterIds.has(member.id))
									.map((member) => {
										const checked = rosterIds.has(member.id)

										return (
											<li key={member.id}>
												<label className="flex items-center gap-3 px-4 py-2">
													<input
														type="checkbox"
														checked={checked}
														onChange={() =>
															setRosterIds((current) => {
																const next = new Set(current)
																if (checked) next.delete(member.id)
																else next.add(member.id)

																return next
															})
														}
														className="accent-brand-600 size-5 min-h-0 shrink-0"
													/>
													<span className="min-w-0 flex-1">
														<span className={cn('block truncate text-sm', checked ? 'text-ink' : 'text-ink-faint')}>
															{member.name}
															{member.jerseyNumber === null ? null : (
																<span className="text-ink-faint tabular"> · {member.jerseyNumber}</span>
															)}
														</span>
														<span className="text-ink-faint block text-xs">
															{roleLabels[member.role]}
															{member.status === 'left' ? ' · odešel' : null}
														</span>
													</span>
												</label>
											</li>
										)
									})}
							</ul>
						</>
					)}

					{error === null ? null : (
						<p role="alert" className="bg-debt-500/15 text-debt mx-4 mt-3 rounded-xl px-3 py-2 text-sm">
							{error}
						</p>
					)}

					<div className="border-line/60 flex items-center justify-between gap-3 border-t px-4 py-3">
						<Button variant="ghost" onClick={() => setStep('pricelist')}>
							Zpět
						</Button>
						<div className="text-right">
							<p className="text-ink-faint mb-1 text-xs">Převezme se {Object.keys(prices).length} položek sazebníku</p>
							<Button variant="accent" size="lg" loading={saving} onClick={() => void submit()}>
								Založit sezónu
							</Button>
						</div>
					</div>
				</Card>
			) : null}
		</div>
	)
}
