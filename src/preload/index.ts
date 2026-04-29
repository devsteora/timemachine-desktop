import { contextBridge, ipcRenderer } from 'electron';

interface SessionSnapshotDTO {
  sessionStartedAt: number | null;
  isPaused: boolean;
  onBreak: boolean;
  headerLabel: string;
  headerElapsedSeconds: number;
  workedMinutes: number;
  idleMinutes: number;
  segments: {
    id: string;
    start: number;
    end?: number;
    activity: string;
    note?: string;
  }[];
  startedAtFormatted: string | null;
  idleStreakWallClockActive: boolean;
}

contextBridge.exposeInMainWorld('api', {
  forceSync: () => ipcRenderer.invoke('force-sync'),
  minimizeWindow: () => ipcRenderer.invoke('window-minimize'),
  authGetState: () =>
    ipcRenderer.invoke('auth-get-state') as Promise<{
      apiBaseUrl: string;
      isAuthenticated: boolean;
      userEmail: string | null;
      userId: string | null;
      agentLockedDown: boolean;
    }>,
  authLogin: (opts: { apiBaseUrl: string; email: string; password: string }) =>
    ipcRenderer.invoke('auth-login', opts) as Promise<
      | { ok: true; user: { id: string; email: string; role: string } }
      | { ok: false; error: string }
    >,
  authLogout: () =>
    ipcRenderer.invoke('auth-logout') as Promise<
      { ok: true } | { ok: false; error: string }
    >,
  toggleBreak: () => ipcRenderer.invoke('toggle-break') as Promise<boolean>,
  togglePause: () => ipcRenderer.invoke('toggle-pause') as Promise<boolean>,
  startBreakDetails: (payload: { reason: string; description: string }) =>
    ipcRenderer.invoke('start-break-details', payload) as Promise<{ ok: boolean }>,
  finishDay: () => ipcRenderer.invoke('finish-day') as Promise<{ ok: boolean }>,
  getBreakState: () => ipcRenderer.invoke('get-break-state') as Promise<boolean>,
  getSessionState: () =>
    ipcRenderer.invoke('get-session-state') as Promise<SessionSnapshotDTO>,
  getSyncStatus: () =>
    ipcRenderer.invoke('get-sync-status') as Promise<{
      lastSyncAt: number | null;
      syncIntervalMs: number;
    }>,
  getPreferences: () =>
    ipcRenderer.invoke('get-preferences') as Promise<{
      autoTracking: boolean;
      breakReminderMinutes: number;
    }>,
  savePreferences: (prefs: {
    autoTracking?: boolean;
    breakReminderMinutes?: number;
  }) => ipcRenderer.invoke('save-preferences', prefs),
  openDashboard: (url: string) => ipcRenderer.invoke('open-dashboard', url),
  getAppMeta: () =>
    ipcRenderer.invoke('get-app-meta') as Promise<{
      version: string;
      name: string;
    }>,
  mailGetComposeContext: () =>
    ipcRenderer.invoke('mail-get-compose-context') as Promise<
      | {
          ok: true;
          managers: { name: string; email: string }[];
          assigned_manager_email: string | null;
        }
      | { ok: false; error: string }
    >,
  mailSend: (payload: {
    subject: string;
    body: string;
    recipient_email: string;
  }) =>
    ipcRenderer.invoke('mail-send', payload) as Promise<
      | { ok: true; sent_to: string }
      | { ok: false; error: string }
    >,
  getTeamPresence: () =>
    ipcRenderer.invoke('get-team-presence') as Promise<
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
    >,
  onStatusUpdate: (callback: (status: string) => void) => {
    ipcRenderer.on('status-update', (_event, status) => callback(status));
  },
  onSessionUpdate: (callback: (snap: SessionSnapshotDTO) => void) => {
    ipcRenderer.on('session-update', (_event, snap) => callback(snap));
  },
  removeSessionListener: () => {
    ipcRenderer.removeAllListeners('session-update');
  },
  removeStatusListener: () => {
    ipcRenderer.removeAllListeners('status-update');
  },
  idleResolveWork: (payload: { description: string }) =>
    ipcRenderer.invoke('idle-resolve-work', payload) as Promise<{ ok: true }>,
  idleResolveBreak: (payload: { reason: string; description?: string }) =>
    ipcRenderer.invoke('idle-resolve-break', payload) as Promise<{ ok: true }>,
  onIdleWarning: (
    callback: (payload: { deadlineMs: number; startedAt: number }) => void
  ) => {
    const handler = (
      _event: unknown,
      payload: { deadlineMs: number; startedAt: number }
    ) => callback(payload);
    ipcRenderer.on('idle-warning', handler);
    return () => ipcRenderer.removeListener('idle-warning', handler);
  },
  onIdleResolutionRequired: (
    callback: (payload: { startedAt: number; now: number }) => void
  ) => {
    const handler = (
      _event: unknown,
      payload: { startedAt: number; now: number }
    ) => callback(payload);
    ipcRenderer.on('idle-resolution-required', handler);
    return () =>
      ipcRenderer.removeListener('idle-resolution-required', handler);
  },
  onIdleResolutionDismissed: (callback: () => void) => {
    const handler = () => callback();
    ipcRenderer.on('idle-resolution-dismissed', handler);
    return () =>
      ipcRenderer.removeListener('idle-resolution-dismissed', handler);
  },
});
