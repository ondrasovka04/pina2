import type { SubmitEvent } from 'react'
import { useEffect, useState } from 'react'
import { Link } from 'react-router'

import { useTeam } from '@/app/team'
import { Button } from '@/components/ui/Button'
import { Card } from '@/components/ui/Card'
import { Field } from '@/components/ui/Field'
import { ApiError } from '@/lib/api'
import { useLocations, useSaveTeamSettings } from '@/lib/queries'
import type { SettlementPeriod, TeamDetail, TeamSettings } from '@/lib/types'

const selectClassName = 'rounded-xl border border-line bg-surface-2 px-3 py-2.5 text-base text-ink'

const settlementPeriods: SettlementPeriod[] = ['none', 'half_year', 'season']

const settlementLabels: Record<SettlementPeriod, string> = {
	none: 'Nepoužívá se',
	half_year: 'Po pololetích',
	season: 'Celá sezóna',
}

/** Ověří hodnotu z `<select>` proti známým obdobím — vyhne se přetypování na `SettlementPeriod`. */
function toSettlementPeriod(value: string): SettlementPeriod {
	return settlementPeriods.find((period) => period === value) ?? 'none'
}

function settingsEqual(a: TeamSettings, b: TeamSettings): boolean {
	return (
		a.travelEnabled === b.travelEnabled &&
		a.travelRateCzkKm === b.travelRateCzkKm &&
		a.travelRoundTrip === b.travelRoundTrip &&
		a.settlementPeriod === b.settlementPeriod &&
		a.homeLocationId === b.homeLocationId &&
		a.attendanceVisibleToPlayers === b.attendanceVisibleToPlayers &&
		a.balancesVisibleToPlayers === b.balancesVisibleToPlayers
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
 */
export function TeamSettingsSection({ team }: { team: TeamDetail }) {
	const { can } = useTeam()
	const locations = useLocations(team.clubId)
	const save = useSaveTeamSettings(team.id)

	const [settings, setSettings] = useState<TeamSettings>(team.settings)
	// Sazba za km se edituje jako text, ať jde napsat desetinná tečka/čárka bez skákání kurzoru.
	const [rateInput, setRateInput] = useState(String(team.settings.travelRateCzkKm))
	const [saved, setSaved] = useState(false)

	// Přepnutí družstva (nebo čerstvá data ze serveru) — rozepsaný formulář nemá přežít pod cizím nastavením.
	useEffect(() => {
		setSettings({
			travelEnabled: team.settings.travelEnabled,
			travelRateCzkKm: team.settings.travelRateCzkKm,
			travelRoundTrip: team.settings.travelRoundTrip,
			settlementPeriod: team.settings.settlementPeriod,
			homeLocationId: team.settings.homeLocationId,
			attendanceVisibleToPlayers: team.settings.attendanceVisibleToPlayers,
			balancesVisibleToPlayers: team.settings.balancesVisibleToPlayers,
		})
		setRateInput(String(team.settings.travelRateCzkKm))
		setSaved(false)
	}, [
		team.id,
		team.settings.travelEnabled,
		team.settings.travelRateCzkKm,
		team.settings.travelRoundTrip,
		team.settings.settlementPeriod,
		team.settings.homeLocationId,
		team.settings.attendanceVisibleToPlayers,
		team.settings.balancesVisibleToPlayers,
	])

	if (!can('admin')) return null

	const parsedRate = Number.parseFloat(rateInput.replace(',', '.'))
	const candidate: TeamSettings = {
		...settings,
		travelRateCzkKm: Number.isFinite(parsedRate) ? parsedRate : 0,
	}
	const dirty = !settingsEqual(candidate, team.settings)

	function update(changes: Partial<TeamSettings>) {
		setSaved(false)
		setSettings((current) => ({ ...current, ...changes }))
	}

	async function submit(event: SubmitEvent<HTMLFormElement>) {
		event.preventDefault()

		try {
			await save.mutateAsync(candidate)
			setSaved(true)
		} catch {
			// hláška se ukáže přes save.error níž
		}
	}

	const locationList = locations.data ?? []

	return (
		<Card className="flex flex-col gap-4 px-4 py-4">
			<h2 className="font-semibold">Nastavení družstva</h2>

			<form onSubmit={submit} className="flex flex-col gap-5">
				<div className="flex flex-col gap-1.5">
					<label className="flex flex-col gap-1.5">
						<span className="text-ink-muted text-sm font-medium">Domácí hala</span>
						<select
							value={settings.homeLocationId ?? ''}
							onChange={(event) => {
								const raw = event.target.value

								update({ homeLocationId: raw === '' ? null : Number.parseInt(raw, 10) })
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
						onChange={(event) => update({ attendanceVisibleToPlayers: event.target.checked })}
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
						onChange={(event) => update({ balancesVisibleToPlayers: event.target.checked })}
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
							onChange={(event) => update({ travelEnabled: event.target.checked })}
						/>
						<span className="flex flex-col">
							<span className="text-sm font-medium">Cesťáky</span>
							<span className="text-ink-faint text-xs">
								Náhrada za jízdu autem na venkovní zápasy. Zatím se teprve dodělávají, takže se zatím nikam nepočítají.
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
								onChange={(event) => {
									setSaved(false)
									setRateInput(event.target.value)
								}}
								error={fieldMessage(save.error, 'travelRateCzkKm')}
							/>
							<label className="flex min-h-11 items-center gap-3">
								<input
									type="checkbox"
									className="size-5 shrink-0"
									checked={settings.travelRoundTrip}
									onChange={(event) => update({ travelRoundTrip: event.target.checked })}
								/>
								<span className="text-sm">Proplácí se cesta tam i zpět</span>
							</label>
						</div>
					) : null}
				</div>

				<label className="flex flex-col gap-1.5">
					<span className="text-ink-muted text-sm font-medium">Zúčtovací období</span>
					<select
						value={settings.settlementPeriod}
						onChange={(event) => update({ settlementPeriod: toSettlementPeriod(event.target.value) })}
						className={selectClassName}
					>
						{settlementPeriods.map((period) => (
							<option key={period} value={period}>
								{settlementLabels[period]}
							</option>
						))}
					</select>
				</label>

				{generalMessage(save.error) === undefined ? null : (
					<p role="alert" className="text-debt text-sm">
						{generalMessage(save.error)}
					</p>
				)}

				{!dirty && saved ? <p className="text-ink-muted text-sm">Nastavení uloženo.</p> : null}

				<div className="flex justify-end">
					<Button type="submit" disabled={!dirty} loading={save.isPending}>
						Uložit
					</Button>
				</div>
			</form>
		</Card>
	)
}
