import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import {
	createBrowserRouter,
	createRoutesFromElements,
	Link,
	Navigate,
	Outlet,
	Route,
	RouterProvider,
	ScrollRestoration,
} from 'react-router'

import { AppLayout } from '@/app/AppLayout'
import { SessionProvider, useSession } from '@/app/session'
import { TeamProvider } from '@/app/team'
import { ClubMark } from '@/components/ClubMark'
import { PlatformPage } from '@/features/admin/PlatformPage'
import { AcceptInvitationPage } from '@/features/auth/AcceptInvitationPage'
import { ForgotPasswordPage } from '@/features/auth/ForgotPasswordPage'
import { LoginPage } from '@/features/auth/LoginPage'
import { NewPasswordPage } from '@/features/auth/NewPasswordPage'
import { BalancesPage } from '@/features/balances/BalancesPage'
import { MemberPage } from '@/features/balances/MemberPage'
import { PaymentsPage } from '@/features/balances/PaymentsPage'
import { AttendancePage } from '@/features/events/AttendancePage'
import { CalendarPage } from '@/features/events/CalendarPage'
import { EditEventPage } from '@/features/events/EditEventPage'
import { EventPage } from '@/features/events/EventPage'
import { LocationsPage } from '@/features/events/LocationsPage'
import { NewEventPage } from '@/features/events/NewEventPage'
import { SeriesPage } from '@/features/events/SeriesPage'
import { BatchesPage } from '@/features/offences/BatchesPage'
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
			// Slabý signál v hale — opakovat jen chyby, ne 4xx
			retry: (failureCount, error) => {
				if (error instanceof ApiError && error.status < 500) return false

				return failureCount < 2
			},
			refetchOnWindowFocus: false,
		},
	},
})

// Datový router kvůli useBlocker — chrání rozepsaný zápis před odchodem
const router = createBrowserRouter(
	createRoutesFromElements(
		<Route element={<SessionRoot />}>
			<Route path="/prihlaseni" element={<AnonymousOnly />} />
			{/* Veřejné: celé oprávnění nese token v adrese. */}
			<Route path="/pozvanka" element={<AcceptInvitationPage />} />
			<Route path="/zapomenute-heslo" element={<ForgotPasswordPage />} />
			<Route path="/nove-heslo" element={<NewPasswordPage />} />

			<Route element={<Protected />}>
				<Route element={<AppLayout />}>
					<Route index element={<Navigate to="/kalendar" replace />} />
					<Route path="dluhy" element={<BalancesPage />} />
					<Route path="platby" element={<PaymentsPage />} />
					<Route path="hraci/:membershipId" element={<MemberPage />} />
					<Route path="kalendar" element={<CalendarPage />} />
					<Route path="akce/nova" element={<NewEventPage />} />
					<Route path="akce/:eventId" element={<EventPage />} />
					<Route path="akce/:eventId/upravit" element={<EditEventPage />} />
					<Route path="serie" element={<SeriesPage />} />
					<Route path="dochazka" element={<AttendancePage />} />
					<Route path="mista" element={<LocationsPage />} />
					<Route path="zapsat" element={<NewBatchPage />} />
					<Route path="zapisy" element={<BatchesPage />} />
					<Route path="sazebnik" element={<OffenceTypesPage />} />
					<Route path="druzstvo" element={<TeamPage />} />
					<Route path="sprava" element={<PlatformPage />} />
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
			{/*
			 * Bez tohohle si prohlížeč drží pozici posuvníku i po přechodu na jinou
			 * obrazovku — kdo klikl na akci dole v kalendáři, otevřel si její detail
			 * někde v půlce. Nová navigace tedy vyjede nahoru, zatímco tlačítko zpět
			 * vrátí člověka tam, kde v seznamu skončil.
			 */}
			<ScrollRestoration />
			<Outlet />
		</SessionProvider>
	)
}

// Chvíli načítání relace — bez toho by se zobrazila login obrazovka
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
	if (status === 'authenticated') return <Navigate to="/kalendar" replace />

	return <LoginPage />
}

function NotFoundPage() {
	return (
		<main className="grid min-h-dvh place-items-center px-6 text-center">
			<div className="flex flex-col items-center gap-4">
				<h1 className="text-xl font-semibold">Tahle stránka neexistuje</h1>
				<Link
					to="/kalendar"
					role="button"
					className="bg-brand-600 inline-flex min-h-11 items-center rounded-xl px-4 text-sm text-white"
				>
					Zpátky do kalendáře
				</Link>
			</div>
		</main>
	)
}
