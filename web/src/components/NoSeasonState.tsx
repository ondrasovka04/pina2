import { Link } from 'react-router'

import { useTeam } from '@/app/team'
import { EmptyState } from '@/components/ui/States'

/**
 * Různé zprávy podle role. Pínař/admin vidí: žádná sezóna není.
 * Hráč vidí: nepatří do žádné.
 */
export function NoSeasonState({ what = 'zápisy' }: { what?: string }) {
	const { can } = useTeam()

	if (can('treasurer')) {
		return (
			<EmptyState
				title="Družstvo nemá žádnou sezónu"
				description={`Bez sezóny není kam ${what} vázat. Založí ji admin družstva.`}
				action={
					can('admin') ? (
						<Link
							to="/sezony/nova"
							role="button"
							className="bg-accent text-on-accent mt-1 inline-flex min-h-11 items-center rounded-xl px-4 text-sm font-semibold"
						>
							Založit sezónu
						</Link>
					) : undefined
				}
			/>
		)
	}

	return (
		<EmptyState
			title="Zatím pro vás není žádná sezóna"
			description="Vidíte sezóny, na jejichž soupisce jste. Požádejte admina družstva, aby vás na tu letošní přidal."
		/>
	)
}
