import { lazy, Suspense } from 'react';
import type { ComponentType } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { ApiRequestError } from './api/client';
import { AuthProvider } from './auth/AuthProvider';
import { RequireAuth, RequireOnboarded } from './auth/guards';
import { AppShell } from './shell/AppShell';
import { MasterDetail } from './shell/MasterDetail';
import { AuthPage } from './pages/AuthPage';
import { OnboardingPage } from './pages/OnboardingPage';
import { TodayPage } from './pages/TodayPage';
import { ErrorBoundary } from './ui/ErrorBoundary';

// Everything except sign-in, setup and Today loads on demand, so the first screen arrives fast on mobile data.
const lazyPage = <K extends string>(load: () => Promise<Record<K, ComponentType>>, name: K) =>
  lazy(() => load().then((m) => ({ default: m[name] })));
const JobsPage = lazyPage(() => import('./pages/JobsPage'), 'JobsPage');
const JobPage = lazyPage(() => import('./pages/JobPage'), 'JobPage');
const PeoplePage = lazyPage(() => import('./pages/PeoplePage'), 'PeoplePage');
const CustomerPage = lazyPage(() => import('./pages/CustomerPage'), 'CustomerPage');
const SearchPage = lazyPage(() => import('./pages/SearchPage'), 'SearchPage');
const ReviewPage = lazyPage(() => import('./pages/ReviewPage'), 'ReviewPage');
const SettingsPage = lazyPage(() => import('./pages/SettingsPage'), 'SettingsPage');
const NewRequestPage = lazyPage(() => import('./pages/NewRequestPage'), 'NewRequestPage');
const KitPage = lazyPage(() => import('./pages/KitPage'), 'KitPage');
const NotFoundPage = lazyPage(() => import('./pages/NotFoundPage'), 'NotFoundPage');

const queryClient = new QueryClient({
  defaultOptions: {
    // Offline should fail fast with a clear message, not hang on a spinner; and never queue a payment action for later.
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
          <AuthProvider>
            <Suspense fallback={null}>
              <Routes>
                <Route path="/auth" element={<AuthPage />} />
                <Route element={<RequireAuth />}>
                  <Route path="/onboarding" element={<OnboardingPage />} />
                  <Route element={<RequireOnboarded />}>
                    <Route element={<AppShell />}>
                      <Route path="/" element={<Navigate to="/today" replace />} />
                      <Route path="/today" element={<TodayPage />} />
                      <Route path="/jobs" element={<MasterDetail base="jobs" list={<JobsPage />} empty="Pick a job to see its payments, timeline and next step." />}>
                        <Route path=":id" element={<JobPage />} />
                      </Route>
                      <Route path="/people" element={<MasterDetail base="people" list={<PeoplePage />} empty="Pick a customer to see what they owe and their history." />}>
                        <Route path=":id" element={<CustomerPage />} />
                      </Route>
                      <Route path="/search" element={<SearchPage />} />
                      <Route path="/review" element={<ReviewPage />} />
                      <Route path="/settings" element={<SettingsPage />} />
                      <Route path="/new" element={<NewRequestPage />} />
                      <Route path="/kit" element={<KitPage />} />
                      <Route path="*" element={<NotFoundPage />} />
                    </Route>
                  </Route>
                </Route>
              </Routes>
            </Suspense>
          </AuthProvider>
        </BrowserRouter>
      </QueryClientProvider>
    </ErrorBoundary>
  );
}
