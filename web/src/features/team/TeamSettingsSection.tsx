import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router'

import { useTeam } from '@/app/team'
import { Card } from '@/components/ui/Card'
import { Field } from '@/components/ui/Field'
import { Select } from '@/components/ui/Select'
import { ApiError } from '@/lib/api'
import { useLocations, useSaveTeamSettings } from '@/lib/queries'
import type { TeamDetail, TeamSettings } from '@/lib/types'
import { looksLikeBankAccount } from '@/lib/validation'

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
		a.rsvpDeadlineTrainingHours === b.rsvpDeadlineTrainingHours &&
		a.rsvpDeadlineMatchHours === b.rsvpDeadlineMatchHours &&
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
 * Ukládá se bez tlačítka a při chybě se hodnota vrátí na naposledy potvrzenou —
 * obrazovka nesmí ukazovat nastavení, které nikde neplatí.
 */
export function TeamSettingsSection({ team }: { team: TeamDetail }) {
	const { can } = useTeam()
	const locations = useLocations(team.clubId)
	const save = useSaveTeamSettings(team.id)

	const [settings, setSettings] = useState<TeamSettings>(team.settings)
	// Obě textová pole mají vlastní nárazník: do `settings` se hodnota dostane až
	// ve chvíli, kdy se dá uložit. Rozepsaná „5," ani půlka účtu tam nemají co dělat.
	const [rateInput, setRateInput] = useState(String(team.settings.travelRateCzkKm))
	const [accountInput, setAccountInput] = useState(team.settings.bankAccount ?? '')
	const [trainingDeadlineInput, setTrainingDeadlineInput] = useState(
		team.settings.rsvpDeadlineTrainingHours?.toString() ?? '',
	)
	const [matchDeadlineInput, setMatchDeadlineInput] = useState(team.settings.rsvpDeadlineMatchHours?.toString() ?? '')
	const [status, setStatus] = useState<Status>('idle')

	// Požadavky jdou ve frontě, ať rychlé přepínání nedoručí starší stav jako poslední.
	const queue = useRef<Promise<unknown>>(Promise.resolve())
	/** Poslední potvrzený stav; při chybě se formulář vrátí k němu. */
	const confirmed = useRef<TeamSettings>(team.settings)
	/** Zrcadlo hodnot pro dvě změny dřív, než se komponenta překreslí. */
	const latest = useRef<TeamSettings>(team.settings)
	const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
	/** Pořadí naplánovaných uložení — starší odpověď nesmí přepsat novější stav. */
	const pending = useRef(0)
	/** Družstvo, kterému formulář právě patří; čte se z běžící odpovědi. */
	const shownTeamId = useRef(team.id)

	// Přepnutí družstva zruší rozepsané uložení. Bez toho by naplánovaný požadavek
	// odletěl už pod novým družstvem — `useSaveTeamSettings` míří na aktuální id,
	// takže by cizí nastavení přepsalo to zobrazené.
	useEffect(() => {
		shownTeamId.current = team.id

		return () => clearTimeout(timer.current ?? undefined)
	}, [team.id])

	// Čerstvá data ze serveru — rozepsaný formulář nemá přežít pod jiným nastavením.
	// Vlastní uložení sem dorazí taky, ale to se od `confirmed` neliší, takže hlášku
	// „uloženo" nesmaže.
	useEffect(() => {
		if (settingsEqual(team.settings, confirmed.current)) return

		confirmed.current = team.settings
		latest.current = team.settings
		setSettings(team.settings)
		setRateInput(String(team.settings.travelRateCzkKm))
		setAccountInput(team.settings.bankAccount ?? '')
		setTrainingDeadlineInput(team.settings.rsvpDeadlineTrainingHours?.toString() ?? '')
		setMatchDeadlineInput(team.settings.rsvpDeadlineMatchHours?.toString() ?? '')
		setStatus('idle')
	}, [team.id, team.settings])

	if (!can('admin')) return null

	/** Zapíše hodnotu do formuláře. Samo o sobě neukládá. */
	function stage(changes: Partial<TeamSettings>): TeamSettings {
		const next = { ...latest.current, ...changes }

		latest.current = next
		setSettings(next)

		return next
	}

	/**
	 * Rozepsaný text jen čeká: zruší naplánované uložení a do `latest` vrátí
	 * potvrzenou hodnotu. Bez toho by naplánované uložení z předchozí klávesy
	 * vystřelilo doprostřed psaní — a cvaknutí přepínače by odeslalo číslo účtu,
	 * které uživatel mezitím rozepsal do něčeho jiného.
	 */
	function hold(changes: Partial<TeamSettings>) {
		const next = stage(changes)

		clearTimeout(timer.current ?? undefined)
		setStatus(settingsEqual(next, confirmed.current) ? 'idle' : 'saving')
	}

	/** Naplánuje uložení; další změna během čekání ho nahradí, nepošlou se obě. */
	function apply(changes: Partial<TeamSettings>, delayMs = 0) {
		const next = stage(changes)

		clearTimeout(timer.current ?? undefined)

		if (settingsEqual(next, confirmed.current)) {
			setStatus('idle')

			return
		}

		setStatus('saving')

		const seq = ++pending.current
		timer.current = setTimeout(() => persist(next, seq), delayMs)
	}

	function persist(next: TeamSettings, seq: number) {
		const forTeam = team.id

		queue.current = queue.current
			.then(async () => {
				await save.mutateAsync(next)

				if (forTeam !== shownTeamId.current) return

				confirmed.current = next
				if (seq === pending.current) setStatus('saved')
			})
			.catch(() => {
				if (forTeam !== shownTeamId.current) return
				// Selhalo starší uložení a mezitím přišla další změna — tu nechme být.
				// Obrazovka nesmí zahodit, co uživatel právě naklikal.
				if (seq !== pending.current) return

				latest.current = confirmed.current
				setSettings(confirmed.current)
				setRateInput(String(confirmed.current.travelRateCzkKm))
				setAccountInput(confirmed.current.bankAccount ?? '')
				setTrainingDeadlineInput(confirmed.current.rsvpDeadlineTrainingHours?.toString() ?? '')
				setMatchDeadlineInput(confirmed.current.rsvpDeadlineMatchHours?.toString() ?? '')
				setStatus('error')
			})
	}

	/** Nedopsané číslo se neposílá — prázdné pole není nula korun za kilometr. */
	function changeRate(raw: string) {
		setRateInput(raw)

		const parsed = Number.parseFloat(raw.replace(',', '.'))

		if (Number.isFinite(parsed)) apply({ travelRateCzkKm: parsed }, TEXT_DELAY_MS)
		else hold({ travelRateCzkKm: confirmed.current.travelRateCzkKm })
	}

	/**
	 * Půlka účtu se neposílá. Server by ji odmítl a hláška by naskočila uprostřed
	 * psaní — a hlavně na tohle číslo míří QR kód s reálnou platbou, takže tam
	 * nesmí ani dočasně stát něco, co uživatel teprve dopisuje.
	 */
	function changeAccount(raw: string) {
		setAccountInput(raw)

		const account = raw.trim()

		if (account === '') apply({ bankAccount: null }, TEXT_DELAY_MS)
		else if (looksLikeBankAccount(account)) apply({ bankAccount: account }, TEXT_DELAY_MS)
		else hold({ bankAccount: confirmed.current.bankAccount })
	}

	function changeDeadline(raw: string, field: 'rsvpDeadlineTrainingHours' | 'rsvpDeadlineMatchHours') {
		if (field === 'rsvpDeadlineTrainingHours') setTrainingDeadlineInput(raw)
		else setMatchDeadlineInput(raw)

		if (raw.trim() === '') {
			apply({ [field]: null }, TEXT_DELAY_MS)
			return
		}

		const parsed = Number(raw)
		if (Number.isInteger(parsed)) apply({ [field]: parsed }, TEXT_DELAY_MS)
		else hold({ [field]: confirmed.current[field] })
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
						<Select
							value={settings.homeLocationId ?? ''}
							onChange={(event) => {
								const raw = event.target.value

								apply({ homeLocationId: raw === '' ? null : Number.parseInt(raw, 10) })
							}}
							disabled={locations.isPending}
						>
							<option value="">Neurčeno</option>
							{locationList.map((location) => (
								<option key={location.id} value={location.id}>
									{location.name}
								</option>
							))}
						</Select>
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

				<div className="flex flex-col gap-2">
					<div className="grid grid-cols-2 gap-3">
						<Field
							label="Zápis na trénink (h)"
							type="number"
							inputMode="numeric"
							min={1}
							max={720}
							placeholder="vypnuto"
							value={trainingDeadlineInput}
							onChange={(event) => changeDeadline(event.target.value, 'rsvpDeadlineTrainingHours')}
							error={fieldMessage(save.error, 'rsvpDeadlineTrainingHours')}
						/>
						<Field
							label="Zápis na zápas (h)"
							type="number"
							inputMode="numeric"
							min={1}
							max={720}
							placeholder="vypnuto"
							value={matchDeadlineInput}
							onChange={(event) => changeDeadline(event.target.value, 'rsvpDeadlineMatchHours')}
							error={fieldMessage(save.error, 'rsvpDeadlineMatchHours')}
						/>
					</div>
					<p className="text-ink-faint text-xs">
						Počet hodin před začátkem. Prázdné pole termín vypne. Odpovědět půjde i potom, ale zápis bude označený jako
						pozdní.
					</p>
				</div>

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
					value={accountInput}
					onChange={(event) => changeAccount(event.target.value)}
					error={fieldMessage(save.error, 'bankAccount')}
					hint="Účet tohohle družstva. Lze zadat české číslo účtu nebo IBAN."
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
