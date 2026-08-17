import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router'

import { useTeam } from '@/app/team'
import { Card } from '@/components/ui/Card'
import { Field } from '@/components/ui/Field'
import { ApiError } from '@/lib/api'
import { useLocations, useSaveTeamSettings } from '@/lib/queries'
import type { TeamDetail, TeamSettings } from '@/lib/types'

const selectClassName = 'rounded-xl border border-line bg-surface-2 px-3 py-2.5 text-base text-ink'

/**
 * Text se ukládá se zpožděním, přepínače hned. Za každou stisknutou klávesu by
 * jinak šel požadavek a nad nedopsaným číslem účtu by svítila chyba.
 */
const TEXT_DELAY_MS = 700

type Status = 'idle' | 'saving' | 'saved' | 'error'

function settingsEqual(a: TeamSettings, b: TeamSettings): boolean {
	return (
		a.travelEnabled === b.travelEnabled &&
		a.travelRateCzkKm === b.travelRateCzkKm &&
		a.travelRoundTrip === b.travelRoundTrip &&
		a.homeLocationId === b.homeLocationId &&
		a.attendanceVisibleToPlayers === b.attendanceVisibleToPlayers &&
		a.balancesVisibleToPlayers === b.balancesVisibleToPlayers &&
		a.bankAccount === b.bankAccount
	)
}

/** Vytáhne hlášku pro konkrétní pole formuláře, pokud ji server takhle označil. */
function fieldMessage(error: unknown, field: string): string | undefined {
	return error instanceof ApiError && error.field === field ? error.message : undefined
}

/** Obecná hláška — chyba z API bez konkrétního pole, nebo síťová chyba. */
function generalMessage(error: unknown): string | undefined {
	if (error === null || error === undefined) return undefined
	if (error instanceof ApiError) return error.field === undefined ? error.message : undefined

	return 'Něco se pokazilo. Zkuste to prosím znovu.'
}

/**
 * Nastavení družstva — vidí a mění jen admin. Nejdůležitější je domácí hala:
 * podle ní se u zápasu pozná doma/venku a za domácí zápas nevzniká cesťák.
 *
 * Bez tlačítka: každá změna jde na server sama, stejně jako soupiska sezóny.
 * Když se uložení nepovede, vrátí se hodnota tam, kde ji server naposledy
 * potvrdil — obrazovka nesmí ukazovat nastavení, které nikde neplatí.
 */
export function TeamSettingsSection({ team }: { team: TeamDetail }) {
	const { can } = useTeam()
	const locations = useLocations(team.clubId)
	const save = useSaveTeamSettings(team.id)

	const [settings, setSettings] = useState<TeamSettings>(team.settings)
	// Sazba za km se edituje jako text, ať jde napsat desetinnou tečku/čárku bez skákání kurzoru.
	const [rateInput, setRateInput] = useState(String(team.settings.travelRateCzkKm))
	const [status, setStatus] = useState<Status>('idle')

	// Požadavky jdou ve frontě, ať rychlé přepínání nedoručí starší stav jako poslední.
	const queue = useRef<Promise<unknown>>(Promise.resolve())
	/** Poslední potvrzený stav; při chybě se formulář vrátí k němu. */
	const confirmed = useRef<TeamSettings>(team.settings)
	/** Zrcadlo hodnot pro dvě změny dřív, než se komponenta překreslí. */
	const latest = useRef<TeamSettings>(team.settings)
	const timer = useRef<ReturnType<typeof setTimeout> | null>(null)

	// Přepnutí družstva nebo cizí změna — rozepsaný formulář nemá přežít pod jiným
	// nastavením. Vlastní uložení sem dorazí taky, ale to se od `confirmed` neliší,
	// takže hlášku „uloženo" nesmaže.
	useEffect(() => {
		if (settingsEqual(team.settings, confirmed.current)) return

		confirmed.current = team.settings
		latest.current = team.settings
		setSettings(team.settings)
		setRateInput(String(team.settings.travelRateCzkKm))
		setStatus('idle')
	}, [
		team.id,
		team.settings,
		team.settings.travelEnabled,
		team.settings.travelRateCzkKm,
		team.settings.travelRoundTrip,
		team.settings.homeLocationId,
		team.settings.attendanceVisibleToPlayers,
		team.settings.balancesVisibleToPlayers,
		team.settings.bankAccount,
	])

	useEffect(() => () => clearTimeout(timer.current ?? undefined), [])

	if (!can('admin')) return null

	/** Naplánuje uložení; další změna během čekání ho nahradí, nepošlou se obě. */
	function apply(changes: Partial<TeamSettings>, delayMs = 0) {
		const next = { ...latest.current, ...changes }

		latest.current = next
		setSettings(next)
		clearTimeout(timer.current ?? undefined)

		if (settingsEqual(next, confirmed.current)) {
			setStatus('idle')

			return
		}

		setStatus('saving')
		timer.current = setTimeout(() => persist(next), delayMs)
	}

	function persist(next: TeamSettings) {
		queue.current = queue.current
			.then(async () => {
				await save.mutateAsync(next)
				confirmed.current = next
				setStatus('saved')
			})
			.catch(() => {
				latest.current = confirmed.current
				setSettings(confirmed.current)
				setRateInput(String(confirmed.current.travelRateCzkKm))
				setStatus('error')
			})
	}

	/** Nedopsané číslo se neposílá — prázdné pole není nula korun za kilometr. */
	function changeRate(raw: string) {
		setRateInput(raw)

		const parsed = Number.parseFloat(raw.replace(',', '.'))
		if (Number.isFinite(parsed)) apply({ travelRateCzkKm: parsed }, TEXT_DELAY_MS)
	}

	const locationList = locations.data ?? []

	return (
		<Card className="flex flex-col gap-4 px-4 py-4">
			<div className="flex flex-wrap items-baseline justify-between gap-x-3">
				<h2 className="font-semibold">Nastavení družstva</h2>
				<SaveStatus status={status} />
			</div>

			<div className="flex flex-col gap-5">
				<div className="flex flex-col gap-1.5">
					<label className="flex flex-col gap-1.5">
						<span className="text-ink-muted text-sm font-medium">Domácí hala</span>
						<select
							value={settings.homeLocationId ?? ''}
							onChange={(event) => {
								const raw = event.target.value

								apply({ homeLocationId: raw === '' ? null : Number.parseInt(raw, 10) })
							}}
							disabled={locations.isPending}
							className={selectClassName}
						>
							<option value="">Neurčeno</option>
							{locationList.map((location) => (
								<option key={location.id} value={location.id}>
									{location.name}
								</option>
							))}
						</select>
					</label>
					<p className="text-ink-faint text-xs">
						Podle domácí haly se u zápasu pozná, jestli je doma nebo venku, a od ní se měří vzdálenost k soupeři.
					</p>
					{fieldMessage(save.error, 'homeLocationId') === undefined ? null : (
						<p role="alert" className="text-debt text-sm">
							{fieldMessage(save.error, 'homeLocationId')}
						</p>
					)}
					{locations.isPending || locationList.length > 0 ? null : (
						<p className="text-ink-faint text-xs">
							Klub zatím nemá žádné místo. Založte ho na stránce{' '}
							<Link to="/mista" className="text-brand-600 underline">
								Místa
							</Link>
							.
						</p>
					)}
				</div>

				<label className="flex min-h-11 items-center gap-3">
					<input
						type="checkbox"
						className="size-5 shrink-0"
						checked={settings.attendanceVisibleToPlayers}
						onChange={(event) => apply({ attendanceVisibleToPlayers: event.target.checked })}
					/>
					<span className="flex flex-col">
						<span className="text-sm font-medium">Docházka ostatních</span>
						<span className="text-ink-faint text-xs">
							Když je vypnuto, hráči vidí jen svou vlastní docházku. Pínař a admin vidí docházku všech vždy.
						</span>
					</span>
				</label>

				<label className="flex min-h-11 items-center gap-3">
					<input
						type="checkbox"
						className="size-5 shrink-0"
						checked={settings.balancesVisibleToPlayers}
						onChange={(event) => apply({ balancesVisibleToPlayers: event.target.checked })}
					/>
					<span className="flex flex-col">
						<span className="text-sm font-medium">Dluhy ostatních</span>
						<span className="text-ink-faint text-xs">
							Když je vypnuto, hráči vidí jen svůj vlastní dluh. Pínař a admin vidí dluhy všech vždy.
						</span>
					</span>
				</label>

				<div className="flex flex-col gap-3">
					<label className="flex min-h-11 items-center gap-3">
						<input
							type="checkbox"
							className="size-5 shrink-0"
							checked={settings.travelEnabled}
							onChange={(event) => apply({ travelEnabled: event.target.checked })}
						/>
						<span className="flex flex-col">
							<span className="text-sm font-medium">Cesťáky</span>
							<span className="text-ink-faint text-xs">
								Náhrada za jízdu autem na venkovní zápasy se odečítá od dluhu řidiče.
							</span>
						</span>
					</label>

					{settings.travelEnabled ? (
						<div className="ml-8 flex flex-col gap-3">
							<Field
								label="Sazba za kilometr (Kč)"
								type="number"
								inputMode="decimal"
								step={0.1}
								min={0}
								value={rateInput}
								onChange={(event) => changeRate(event.target.value)}
								error={fieldMessage(save.error, 'travelRateCzkKm')}
							/>
							<label className="flex min-h-11 items-center gap-3">
								<input
									type="checkbox"
									className="size-5 shrink-0"
									checked={settings.travelRoundTrip}
									onChange={(event) => apply({ travelRoundTrip: event.target.checked })}
								/>
								<span className="text-sm">Proplácí se cesta tam i zpět</span>
							</label>
						</div>
					) : null}
				</div>

				<Field
					label="Účet pro QR platby"
					placeholder="19-2000145399/0800"
					value={settings.bankAccount ?? ''}
					onChange={(event) =>
						apply({ bankAccount: event.target.value.trim() === '' ? null : event.target.value }, TEXT_DELAY_MS)
					}
					error={fieldMessage(save.error, 'bankAccount')}
					hint="Společný účet klubu. Lze zadat české číslo účtu nebo IBAN."
				/>

				{generalMessage(save.error) === undefined ? null : (
					<p role="alert" className="text-debt text-sm">
						{generalMessage(save.error)}
					</p>
				)}
			</div>
		</Card>
	)
}

/** Bez tlačítka je tohle jediná zpráva o tom, že se něco děje — musí být vidět. */
function SaveStatus({ status }: { status: Status }) {
	if (status === 'error') {
		return (
			<span role="alert" className="text-debt text-sm">
				uložení selhalo, zkuste to znovu
			</span>
		)
	}

	return (
		<span role="status" className="text-sm">
			{status === 'saving' ? <span className="text-ink-faint">ukládá se…</span> : null}
			{status === 'saved' ? <span className="text-bonus">uloženo</span> : null}
		</span>
	)
}
