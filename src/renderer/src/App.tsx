'use client';

import { useEffect, useState, type CSSProperties } from 'react';
import DashboardShell, {
  type SessionSnapshotDTO,
} from './DashboardShell';

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
      if (!result.ok) {
        setLoginError(result.error);
        return;
      }
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
    const result = await window.api.authLogout();
    if (!result.ok) return;
    setIsAuthenticated(false);
    setUserEmail(null);
  };

  if (!authReady) {
    return (
      <div className="flex h-screen items-center justify-center bg-slate-900 text-slate-400">
        <span className="text-sm">Loading…</span>
      </div>
    );
  }

  if (!isAuthenticated) {
    return (
      <div className="flex h-screen flex-col bg-slate-900 font-sans">
        <div className="draggable flex items-center justify-between border-b border-slate-700 bg-slate-800 p-3 rounded-t-lg">
          <span className="text-xs font-bold uppercase tracking-wider text-slate-400">
            Enterprise Agent
          </span>
          <div className="no-drag flex items-center gap-1">
            <button
              type="button"
              className="no-drag flex h-8 w-9 items-center justify-center rounded text-slate-400 hover:bg-slate-700 hover:text-white"
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
                className="flex h-8 w-9 items-center justify-center rounded text-slate-500 hover:bg-slate-700 hover:text-white"
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
          <p className="text-sm text-slate-400">
            Sign in with the same account as the web dashboard. Activity syncs
            to your organization&apos;s API.
          </p>
          <div>
            <label className="mb-1 block text-xs font-medium text-slate-500">
              API base URL
            </label>
            <input
              type="url"
              required
              value={apiBaseUrl}
              onChange={(e) => setApiBaseUrl(e.target.value)}
              className="w-full rounded-md border border-slate-600 bg-slate-950 px-3 py-2 text-sm text-white outline-none focus:border-blue-500"
              placeholder="http://127.0.0.1:8000"
            />
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-slate-500">
              Email
            </label>
            <input
              type="email"
              required
              value={loginEmail}
              onChange={(e) => setLoginEmail(e.target.value)}
              className="w-full rounded-md border border-slate-600 bg-slate-950 px-3 py-2 text-sm text-white outline-none focus:border-blue-500"
              autoComplete="username"
            />
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-slate-500">
              Password
            </label>
            <input
              type="password"
              required
              value={loginPassword}
              onChange={(e) => setLoginPassword(e.target.value)}
              className="w-full rounded-md border border-slate-600 bg-slate-950 px-3 py-2 text-sm text-white outline-none focus:border-blue-500"
              autoComplete="current-password"
            />
          </div>
          {loginError && (
            <p className="text-xs text-red-400">{loginError}</p>
          )}
          <button
            type="submit"
            disabled={loginSubmitting}
            className="mt-2 rounded-lg bg-blue-600 py-2.5 text-sm font-medium text-white hover:bg-blue-500 disabled:opacity-60"
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
      />
    </div>
  );
}
