import { lazy, Suspense } from 'react';
import type { ComponentType } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { BrowserRouter, Navigate, Route, Routes, useParams } from 'react-router-dom';
import { ApiRequestError } from './api/client';
import { AuthProvider } from './auth/AuthProvider';
import { ClerkGate } from './auth/ClerkGate';
import { RequireAuth, RequireOnboarded } from './auth/guards';
import { AppShell } from './shell/AppShell';
import { MasterDetail } from './shell/MasterDetail';
import { AuthPage } from './pages/AuthPage';
import { OnboardingPage } from './pages/OnboardingPage';
import { TodayPage } from './pages/TodayPage';
import { ErrorBoundary } from './ui/ErrorBoundary';

const lazyPage = <K extends string>(load: () => Promise<Record<K, ComponentType>>, name: K) =>
  lazy(() => load().then((m) => ({ default: m[name] })));
const QueuePage = lazyPage(() => import('./pages/QueuePage'), 'QueuePage');
const JobsPage = lazyPage(() => import('./pages/JobsPage'), 'JobsPage');
const JobPage = lazyPage(() => import('./pages/JobPage'), 'JobPage');
const EditJobPage = lazyPage(() => import('./pages/EditJobPage'), 'EditJobPage');
const PeoplePage = lazyPage(() => import('./pages/PeoplePage'), 'PeoplePage');
const CustomerPage = lazyPage(() => import('./pages/CustomerPage'), 'CustomerPage');
const SearchPage = lazyPage(() => import('./pages/SearchPage'), 'SearchPage');
const PaymentsPage = lazyPage(() => import('./pages/PaymentsPage'), 'PaymentsPage');
const NotificationsPage = lazyPage(() => import('./pages/NotificationsPage'), 'NotificationsPage');
const SettingsPage = lazyPage(() => import('./pages/SettingsPage'), 'SettingsPage');
const NewRequestPage = lazyPage(() => import('./pages/NewRequestPage'), 'NewRequestPage');
const KitPage = lazyPage(() => import('./pages/KitPage'), 'KitPage');
const NotFoundPage = lazyPage(() => import('./pages/NotFoundPage'), 'NotFoundPage');
const LandingPage = lazyPage(() => import('./pages/LandingPage'), 'LandingPage');
const PublicPayPage = lazyPage(() => import('./pages/PublicPayPage'), 'PublicPayPage');
const PublicReceiptPage = lazyPage(() => import('./pages/PublicReceiptPage'), 'PublicReceiptPage');
const SignupPage = lazyPage(() => import('./pages/AuthSuitePages'), 'SignupPage');
const VerifyEmailPage = lazyPage(() => import('./pages/AuthSuitePages'), 'VerifyEmailPage');
const ForgotPasswordPage = lazyPage(() => import('./pages/AuthSuitePages'), 'ForgotPasswordPage');
const ResetPasswordPage = lazyPage(() => import('./pages/AuthSuitePages'), 'ResetPasswordPage');
const ServerErrorPage = lazyPage(() => import('./pages/SystemPages'), 'ServerErrorPage');
const MaintenancePage = lazyPage(() => import('./pages/SystemPages'), 'MaintenancePage');

function LegacyPayRedirect() {
  const { token } = useParams();
  return <Navigate to={`/pay/${token ?? ''}`} replace />;
}

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      networkMode: 'always',
      staleTime: 10_000,
      refetchOnWindowFocus: true,
      retry: (count, err) => {
        if (err instanceof ApiRequestError && err.status >= 400 && err.status < 500) return false;
        return count < 2;
      },
    },
    mutations: { networkMode: 'always' },
  },
});

export default function App() {
  return (
    <ErrorBoundary>
      <QueryClientProvider client={queryClient}>
        <BrowserRouter>
          <ClerkGate>
            <AuthProvider>
              <Suspense fallback={null}>
                <Routes>
                  {/* Public Landing, Payment & Receipt routes */}
                  <Route path="/" element={<LandingPage />} />
                  <Route path="/pay/:token" element={<PublicPayPage />} />
                  <Route path="/receipt/:token" element={<PublicReceiptPage />} />
                  <Route path="/p/:token" element={<LegacyPayRedirect />} />

                  {/* Auth & System Pages */}
                  <Route path="/auth" element={<AuthPage />} />
                  <Route path="/login" element={<AuthPage />} />
                  <Route path="/signup" element={<SignupPage />} />
                  <Route path="/verify-email" element={<VerifyEmailPage />} />
                  <Route path="/forgot-password" element={<ForgotPasswordPage />} />
                  <Route path="/reset-password" element={<ResetPasswordPage />} />
                  <Route path="/500" element={<ServerErrorPage />} />
                  <Route path="/maintenance" element={<MaintenancePage />} />
                  <Route path="/404" element={<NotFoundPage />} />

                  <Route element={<RequireAuth />}>
                    <Route path="/onboarding" element={<OnboardingPage />} />
                    <Route element={<RequireOnboarded />}>
                      <Route element={<AppShell />}>
                        {/* Canonical v2 Owner App Routes */}
                        <Route path="/app" element={<TodayPage />} />
                        <Route path="/app/queue" element={<QueuePage />} />
                        <Route path="/app/new" element={<NewRequestPage />} />
                        <Route path="/app/jobs/:id/edit" element={<EditJobPage />} />
                        <Route path="/app/jobs" element={<MasterDetail base="app/jobs" list={<JobsPage />} empty="Pick a job to see its payments, timeline and next step." />}>
                          <Route path=":id" element={<JobPage />} />
                        </Route>
                        <Route path="/app/payments" element={<PaymentsPage />} />
                        <Route path="/app/clients" element={<MasterDetail base="app/clients" list={<PeoplePage />} empty="Pick a client to see what they owe and their history." />}>
                          <Route path=":id" element={<CustomerPage />} />
                        </Route>
                        <Route path="/app/notifications" element={<NotificationsPage />} />
                        <Route path="/app/settings" element={<SettingsPage />} />

                        {/* Legacy route redirects for smooth transition */}
                        <Route path="/today" element={<Navigate to="/app" replace />} />
                        <Route path="/new" element={<Navigate to="/app/new" replace />} />
                        <Route path="/jobs" element={<Navigate to="/app/jobs" replace />} />
                        <Route path="/people" element={<Navigate to="/app/clients" replace />} />
                        <Route path="/review" element={<Navigate to="/app/payments?tab=attention" replace />} />
                        <Route path="/settings" element={<Navigate to="/app/settings" replace />} />
                        <Route path="/search" element={<SearchPage />} />

                        {import.meta.env.DEV && <Route path="/kit" element={<KitPage />} />}
                        <Route path="*" element={<NotFoundPage />} />
                      </Route>
                    </Route>
                  </Route>
                </Routes>
              </Suspense>
            </AuthProvider>
          </ClerkGate>
        </BrowserRouter>
      </QueryClientProvider>
    </ErrorBoundary>
  );
}
