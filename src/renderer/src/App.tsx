'use client';

import { useEffect, useState, type CSSProperties } from 'react';
import DashboardShell, {
  type SessionSnapshotDTO,
} from './DashboardShell';
import { AppLogo } from './AppLogo';

declare global {
  interface Window {
    api: {
      forceSync: () => Promise<{ success: boolean }>;
      minimizeWindow: () => Promise<void>;
      authGetState: () => Promise<{
        apiBaseUrl: string;
        isAuthenticated: boolean;
        userEmail: string | null;
        userId: string | null;
        agentLockedDown: boolean;
      }>;
      authLogin: (opts: {
        apiBaseUrl: string;
        email: string;
        password: string;
      }) => Promise<
        | { ok: true; user: { id: string; email: string; role: string } }
        | { ok: false; error: string }
      >;
      authLogout: () => Promise<{ ok: true } | { ok: false; error: string }>;
      toggleBreak: () => Promise<boolean>;
      togglePause: () => Promise<boolean>;
      startBreakDetails: (payload: {
        reason: string;
        description: string;
      }) => Promise<{ ok: boolean }>;
      finishDay: () => Promise<{ ok: boolean }>;
      getBreakState: () => Promise<boolean>;
      getSessionState: () => Promise<SessionSnapshotDTO>;
      getSyncStatus: () => Promise<{
        lastSyncAt: number | null;
        syncIntervalMs: number;
      }>;
      getPreferences: () => Promise<{
        autoTracking: boolean;
        breakReminderMinutes: number;
      }>;
      savePreferences: (prefs: {
        autoTracking?: boolean;
        breakReminderMinutes?: number;
      }) => Promise<{ ok: boolean }>;
      openDashboard: (url: string) => Promise<void>;
      getAppMeta: () => Promise<{ version: string; name: string }>;
      mailGetComposeContext: () => Promise<
        | {
            ok: true;
            managers: { name: string; email: string }[];
            assigned_manager_email: string | null;
          }
        | { ok: false; error: string }
      >;
      mailSend: (payload: {
        subject: string;
        body: string;
        recipient_email: string;
      }) => Promise<{ ok: true; sent_to: string } | { ok: false; error: string }>;
      getTeamPresence: () => Promise<
        | {
            ok: true;
            members: {
              user_id: string;
              email: string;
              team: string | null;
              state: 'active' | 'idle' | 'on_break' | 'offline';
              last_seen_at: string | null;
            }[];
          }
        | { ok: false; error: string }
      >;
      onStatusUpdate: (callback: (status: string) => void) => void;
      onSessionUpdate: (callback: (snap: SessionSnapshotDTO) => void) => void;
      removeSessionListener: () => void;
      removeStatusListener: () => void;
      idleResolveWork: (payload: {
        description: string;
      }) => Promise<{ ok: true }>;
      idleResolveBreak: (payload: {
        reason: string;
        description?: string;
      }) => Promise<{ ok: true }>;
      onIdleWarning: (
        callback: (payload: { deadlineMs: number; startedAt: number }) => void
      ) => () => void;
      onIdleResolutionRequired: (
        callback: (payload: { startedAt: number; now: number }) => void
      ) => () => void;
      onIdleResolutionDismissed: (callback: () => void) => () => void;
    };
  }
}

export default function App() {
  const [authReady, setAuthReady] = useState(false);
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [userEmail, setUserEmail] = useState<string | null>(null);
  const [apiBaseUrl, setApiBaseUrl] = useState('http://127.0.0.1:8000');
  const [loginEmail, setLoginEmail] = useState('');
  const [loginPassword, setLoginPassword] = useState('');
  const [loginError, setLoginError] = useState<string | null>(null);
  const [loginSubmitting, setLoginSubmitting] = useState(false);
  const [agentLockedDown, setAgentLockedDown] = useState(false);
  /** Shown on the main shell when sign-out fails (e.g. disk error). */
  const [signOutError, setSignOutError] = useState<string | null>(null);

  useEffect(() => {
    void (async () => {
      try {
        const s = await window.api.authGetState();
        setApiBaseUrl(s.apiBaseUrl);
        setIsAuthenticated(s.isAuthenticated);
        setUserEmail(s.userEmail);
        setAgentLockedDown(s.agentLockedDown);
      } finally {
        setAuthReady(true);
      }
    })();
  }, []);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoginError(null);
    setLoginSubmitting(true);
    try {
      const result = await window.api.authLogin({
        apiBaseUrl: apiBaseUrl.trim(),
        email: loginEmail.trim(),
        password: loginPassword,
      });
      if (result.ok === false) {
        setLoginError(result.error);
        return;
      }
      setSignOutError(null);
      setIsAuthenticated(true);
      setUserEmail(result.user.email);
      setLoginPassword('');
    } catch (err: unknown) {
      setLoginError(
        err instanceof Error ? err.message : 'Could not reach the API.'
      );
    } finally {
      setLoginSubmitting(false);
    }
  };

  const handleLogout = async () => {
    setSignOutError(null);
    const emailForForm = userEmail;
    const result = await window.api.authLogout();
    if (result.ok === false) {
      setSignOutError(result.error);
      return;
    }
    setLoginError(null);
    setIsAuthenticated(false);
    setUserEmail(null);
    if (emailForForm) setLoginEmail(emailForForm);
  };

  if (!authReady) {
    return (
      <div className="flex h-screen items-center justify-center bg-ea-deep font-sans text-ea-soft">
        <span className="text-sm font-medium tracking-wide">Loading…</span>
      </div>
    );
  }

  if (!isAuthenticated) {
    return (
      <div className="flex h-screen flex-col bg-gradient-to-b from-ea-deep via-ea-primaryDark to-ea-deep font-sans text-ea-soft">
        <div className="draggable flex items-center justify-between gap-2 border-b border-ea-muted/30 bg-ea-deep/90 px-3 py-3">
          <div className="flex min-w-0 items-center gap-2">
            <AppLogo className="no-drag h-8 w-8 shrink-0" />
            <span className="truncate text-xs font-bold uppercase tracking-wider text-ea-soft">
              Enterprise Agent
            </span>
          </div>
          <div className="no-drag flex shrink-0 items-center gap-1">
            <button
              type="button"
              className="no-drag flex h-8 w-9 items-center justify-center rounded-lg text-ea-soft transition-colors hover:bg-white/10 hover:text-white"
              style={{ WebkitAppRegion: 'no-drag' } as CSSProperties}
              onMouseDown={(e) => e.stopPropagation()}
              onClick={() => void window.api.minimizeWindow()}
              aria-label="Minimize"
            >
              <svg className="h-2.5 w-2.5" viewBox="0 0 12 12" aria-hidden>
                <path fill="currentColor" d="M0 5h12v2H0z" />
              </svg>
            </button>
            {!agentLockedDown && (
              <button
                type="button"
                className="flex h-8 w-9 items-center justify-center rounded-lg text-ea-muted transition-colors hover:bg-white/10 hover:text-white"
                onClick={() => window.close()}
                aria-label="Close"
              >
                ✕
              </button>
            )}
          </div>
        </div>
        <form
          onSubmit={handleLogin}
          className="no-drag flex flex-grow flex-col gap-4 p-5"
        >
          <p className="text-sm leading-relaxed text-ea-soft/90">
            Sign in with the same account as the web dashboard. Activity syncs
            to your organization&apos;s API.
          </p>
          <div>
            <label className="mb-1 block text-xs font-medium text-ea-muted">
              API base URL
            </label>
            <input
              type="url"
              required
              value={apiBaseUrl}
              onChange={(e) => setApiBaseUrl(e.target.value)}
              className="w-full rounded-lg border border-ea-muted/50 bg-ea-deep/50 px-3 py-2 text-sm text-white outline-none ring-ea-primary/30 transition-shadow duration-200 placeholder:text-ea-muted/80 focus:border-ea-primary focus:ring-2"
              placeholder="http://127.0.0.1:8000"
            />
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-ea-muted">
              Email
            </label>
            <input
              type="email"
              required
              value={loginEmail}
              onChange={(e) => setLoginEmail(e.target.value)}
              className="w-full rounded-lg border border-ea-muted/50 bg-ea-deep/50 px-3 py-2 text-sm text-white outline-none transition-shadow duration-200 placeholder:text-ea-muted/80 focus:border-ea-primary focus:ring-2 focus:ring-ea-primary/40"
              autoComplete="username"
            />
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-ea-muted">
              Password
            </label>
            <input
              type="password"
              required
              value={loginPassword}
              onChange={(e) => setLoginPassword(e.target.value)}
              className="w-full rounded-lg border border-ea-muted/50 bg-ea-deep/50 px-3 py-2 text-sm text-white outline-none transition-shadow duration-200 placeholder:text-ea-muted/80 focus:border-ea-primary focus:ring-2 focus:ring-ea-primary/40"
              autoComplete="current-password"
            />
          </div>
          {loginError && (
            <p className="text-xs text-red-300">{loginError}</p>
          )}
          <button
            type="submit"
            disabled={loginSubmitting}
            className="mt-2 rounded-lg bg-ea-primary py-2.5 text-sm font-semibold text-white shadow-lg shadow-ea-deep/40 transition-transform duration-200 hover:scale-[1.02] hover:bg-ea-primaryDark active:scale-[0.98] disabled:opacity-60"
          >
            {loginSubmitting ? 'Signing in…' : 'Sign in'}
          </button>
        </form>
      </div>
    );
  }

  return (
    <div className="box-border flex h-screen w-full flex-col overflow-hidden bg-transparent p-1">
      <DashboardShell
        userEmail={userEmail}
        apiBaseUrl={apiBaseUrl}
        agentLockedDown={agentLockedDown}
        onLogout={handleLogout}
        signOutError={signOutError}
        onDismissSignOutError={() => setSignOutError(null)}
      />
    </div>
  );
}
