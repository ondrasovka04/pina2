import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import {
	createBrowserRouter,
	createRoutesFromElements,
	Link,
	Navigate,
	Outlet,
	Route,
	RouterProvider,
} from 'react-router'

import { AppLayout } from '@/app/AppLayout'
import { SessionProvider, useSession } from '@/app/session'
import { TeamProvider } from '@/app/team'
import { ClubMark } from '@/components/ClubMark'
import { AcceptInvitationPage } from '@/features/auth/AcceptInvitationPage'
import { LoginPage } from '@/features/auth/LoginPage'
import { BalancesPage } from '@/features/balances/BalancesPage'
import { MemberPage } from '@/features/balances/MemberPage'
import { NewBatchPage } from '@/features/offences/NewBatchPage'
import { OffenceTypesPage } from '@/features/offences/OffenceTypesPage'
import { ProfilePage } from '@/features/profile/ProfilePage'
import { NewSeasonWizard } from '@/features/seasons/NewSeasonWizard'
import { SeasonsPage } from '@/features/seasons/SeasonsPage'
import { TeamPage } from '@/features/team/TeamPage'
import { ApiError } from '@/lib/api'

const queryClient = new QueryClient({
	defaultOptions: {
		queries: {
			staleTime: 30_000,
			// V hale bývá slabý signál: opakovat má smysl, ale ne u chyb,
			// které se opakováním nespraví (neexistuje, nemáte právo).
			retry: (failureCount, error) => {
				if (error instanceof ApiError && error.status < 500) return false

				return failureCount < 2
			},
			refetchOnWindowFocus: false,
		},
	},
})

/**
 * Datový router (ne `<BrowserRouter>`) je tu kvůli `useBlocker`: jinak by nešlo
 * zachytit odchod ze stránky s rozepsaným zápisem. Data se dál načítají přes
 * TanStack Query, loadery se nepoužívají.
 */
const router = createBrowserRouter(
	createRoutesFromElements(
		<Route element={<SessionRoot />}>
			<Route path="/prihlaseni" element={<AnonymousOnly />} />
			{/* Pozvánka je veřejná — celé oprávnění nese token v adrese. */}
			<Route path="/pozvanka" element={<AcceptInvitationPage />} />

			<Route element={<Protected />}>
				<Route element={<AppLayout />}>
					<Route index element={<Navigate to="/dluhy" replace />} />
					<Route path="dluhy" element={<BalancesPage />} />
					<Route path="hraci/:membershipId" element={<MemberPage />} />
					<Route path="zapsat" element={<NewBatchPage />} />
					<Route path="sazebnik" element={<OffenceTypesPage />} />
					<Route path="druzstvo" element={<TeamPage />} />
					<Route path="sezony" element={<SeasonsPage />} />
					<Route path="sezony/nova" element={<NewSeasonWizard />} />
					<Route path="ja" element={<ProfilePage />} />
				</Route>
			</Route>

			<Route path="*" element={<NotFoundPage />} />
		</Route>,
	),
)

export function App() {
	return (
		<QueryClientProvider client={queryClient}>
			<RouterProvider router={router} />
		</QueryClientProvider>
	)
}

/** Relace musí obalit celý strom rout, ale sama žádnou cestu neřeší. */
function SessionRoot() {
	return (
		<SessionProvider>
			<Outlet />
		</SessionProvider>
	)
}

/**
 * Než doběhne obnovení relace, nesmí se ukázat ani přihlašovací obrazovka —
 * jinak by přihlášenému uživateli po každém načtení bliklo přihlašování.
 */
function Splash() {
	return (
		<div className="grid min-h-dvh place-items-center">
			<ClubMark className="h-16 animate-pulse" />
		</div>
	)
}

function Protected() {
	const { status } = useSession()

	if (status === 'loading') return <Splash />
	if (status === 'anonymous') return <Navigate to="/prihlaseni" replace />

	return (
		<TeamProvider>
			<Outlet />
		</TeamProvider>
	)
}

function AnonymousOnly() {
	const { status } = useSession()

	if (status === 'loading') return <Splash />
	if (status === 'authenticated') return <Navigate to="/dluhy" replace />

	return <LoginPage />
}

function NotFoundPage() {
	return (
		<main className="grid min-h-dvh place-items-center px-6 text-center">
			<div className="flex flex-col items-center gap-4">
				<h1 className="text-xl font-semibold">Tahle stránka neexistuje</h1>
				<Link
					to="/dluhy"
					role="button"
					className="bg-brand-600 inline-flex min-h-11 items-center rounded-xl px-4 text-sm text-white"
				>
					Zpátky na přehled
				</Link>
			</div>
		</main>
	)
}
