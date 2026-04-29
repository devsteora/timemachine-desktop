import { useEffect, useState, useCallback, type CSSProperties } from 'react';
import { AppLogo } from './AppLogo';

export interface TimeSegmentDTO {
  id: string;
  start: number;
  end?: number;
  activity: string;
  note?: string;
}

export interface SessionSnapshotDTO {
  sessionStartedAt: number | null;
  isPaused: boolean;
  onBreak: boolean;
  headerLabel: string;
  headerElapsedSeconds: number;
  workedMinutes: number;
  idleMinutes: number;
  segments: TimeSegmentDTO[];
  startedAtFormatted: string | null;
  idleStreakWallClockActive: boolean;
}

type Tab = 'home' | 'time' | 'activity' | 'hours' | 'mail' | 'more';

const TEAM_SECTIONS: { code: string | null; label: string }[] = [
  { code: 'DEV', label: 'Dev' },
  { code: 'QC', label: 'QC' },
  { code: 'AV', label: 'AV' },
  { code: 'TRANSCRIPTION', label: 'Transcription' },
  { code: 'ACCOUNTS', label: 'Accounts' },
  { code: 'ORDER_DESK', label: 'Order Desk' },
  { code: 'HR', label: 'HR' },
  { code: 'ADMIN', label: 'Admin' },
  { code: null, label: 'Unassigned' },
];

export interface TeamPresenceMemberDTO {
  user_id: string;
  email: string;
  team: string | null;
  state: 'active' | 'idle' | 'on_break' | 'offline';
  last_seen_at: string | null;
}

const MAIL_PRESETS = [
  {
    id: 'eod',
    label: 'EOD update',
    subject: 'EOD deliverable update',
    body: `Hi,

Completed today:
• 

In progress:
• 

Blockers:
• 

Thanks,`,
  },
  {
    id: 'status',
    label: 'Status',
    subject: 'Quick status update',
    body: `Hi,

Current focus:


Need from you:


Thanks,`,
  },
] as const;

const BREAK_REASONS = [
  'Coffee break',
  'Meal break',
  'Wellness & mobility',
  'Rest & recharge',
  'Personal appointment',
  'Focused offline work',
  'Informal collaboration',
  'Administrative tasks',
  'Compliance / training break',
  'Other',
] as const;

function segmentRowClass(activity: string): string {
  if (activity === 'Working') return 'bg-ea-soft/40';
  if (activity.startsWith('Idle')) return 'bg-ea-muted/25';
  return 'bg-white';
}

function formatHMS(totalSeconds: number): string {
  const s = Math.max(0, Math.floor(totalSeconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`;
}

/** Session aggregates from main are whole minutes — show as Xh Ym / Xm. */
function formatMinutesAsHoursMinutes(totalMinutes: number): string {
  const m = Math.max(0, Math.floor(totalMinutes));
  const h = Math.floor(m / 60);
  const r = m % 60;
  if (h === 0) return `${r}m`;
  if (r === 0) return `${h}h`;
  return `${h}h ${r}m`;
}

function formatSegmentDuration(
  seg: TimeSegmentDTO,
  now: number
): string {
  const end = seg.end ?? now;
  const sec = Math.max(0, Math.floor((end - seg.start) / 1000));
  if (sec < 60) return `${sec}s`;
  const m = Math.floor(sec / 60);
  const r = sec % 60;
  return r ? `${m}m ${r}s` : `${m}m`;
}

function formatClock(ts: number): string {
  return new Date(ts).toLocaleTimeString([], {
    hour: 'numeric',
    minute: '2-digit',
    second: '2-digit',
    hour12: true,
  });
}

function welcomeName(email: string | null): string {
  if (!email) return 'there';
  const local = email.split('@')[0] ?? 'there';
  const cap = local.charAt(0).toUpperCase() + local.slice(1);
  return cap.split(/[._-]/)[0] ?? cap;
}

function displayShortName(email: string): string {
  return welcomeName(email);
}

function presenceBadgeClass(
  state: TeamPresenceMemberDTO['state']
): string {
  switch (state) {
    case 'active':
      return 'bg-ea-soft text-ea-deep';
    case 'idle':
      return 'bg-ea-muted/30 text-ea-primaryDark';
    case 'on_break':
      return 'bg-ea-primary/15 text-ea-primaryDark';
    default:
      return 'bg-ea-soft/50 text-ea-muted';
  }
}

function presenceLabel(state: TeamPresenceMemberDTO['state']): string {
  switch (state) {
    case 'active':
      return 'Active';
    case 'idle':
      return 'Idle';
    case 'on_break':
      return 'On break';
    default:
      return 'Offline';
  }
}

function dashboardOrigin(apiBaseUrl: string): string {
  try {
    const u = new URL(apiBaseUrl);
    if (u.port === '8000' || u.port === '') {
      u.port = '3000';
    }
    return u.origin;
  } catch {
    return 'http://127.0.0.1:3000';
  }
}

interface Props {
  userEmail: string | null;
  apiBaseUrl: string;
  agentLockedDown: boolean;
  onLogout: () => void;
  signOutError?: string | null;
  onDismissSignOutError?: () => void;
}

export default function DashboardShell({
  userEmail,
  apiBaseUrl,
  agentLockedDown,
  onLogout,
  signOutError,
  onDismissSignOutError,
}: Props) {
  const [tab, setTab] = useState<Tab>('home');
  const [session, setSession] = useState<SessionSnapshotDTO | null>(null);
  const [nowTick, setNowTick] = useState(Date.now());
  const [lastSyncAt, setLastSyncAt] = useState<number | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [autoTracking, setAutoTracking] = useState(true);
  const [breakReminder, setBreakReminder] = useState(15);
  const [appVersion, setAppVersion] = useState('');
  const [breakFlow, setBreakFlow] = useState(false);
  const [breakReason, setBreakReason] = useState('');
  const [breakDescription, setBreakDescription] = useState('');
  const [breakFormError, setBreakFormError] = useState<string | null>(null);

  const [idleWarn, setIdleWarn] = useState<{
    deadlineMs: number;
    startedAt: number;
  } | null>(null);
  const [idleResolutionOpen, setIdleResolutionOpen] = useState(false);
  const [idleWorkNote, setIdleWorkNote] = useState('');
  const [idleBreakReason, setIdleBreakReason] = useState('');
  const [idleBreakNote, setIdleBreakNote] = useState('');
  const [idleUiError, setIdleUiError] = useState<string | null>(null);
  const [idleSubmitting, setIdleSubmitting] = useState(false);

  const [mailManagers, setMailManagers] = useState<{ name: string; email: string }[]>(
    []
  );
  const [mailAssignedEmail, setMailAssignedEmail] = useState<string | null>(null);
  const [mailRecipientEmail, setMailRecipientEmail] = useState('');
  const [mailLoadingCtx, setMailLoadingCtx] = useState(false);
  const [mailSubject, setMailSubject] = useState('');
  const [mailBody, setMailBody] = useState('');
  const [mailSending, setMailSending] = useState(false);
  const [mailMsg, setMailMsg] = useState<string | null>(null);

  const [presenceMembers, setPresenceMembers] = useState<TeamPresenceMemberDTO[]>(
    []
  );
  const [presenceLoading, setPresenceLoading] = useState(false);
  const [presenceError, setPresenceError] = useState<string | null>(null);

  useEffect(() => {
    if (tab !== 'mail') return;
    void (async () => {
      setMailLoadingCtx(true);
      setMailMsg(null);
      try {
        const r = await window.api.mailGetComposeContext();
        if (!r.ok) {
          setMailManagers([]);
          setMailAssignedEmail(null);
          setMailRecipientEmail('');
          setMailMsg(r.error);
          return;
        }
        setMailManagers(r.managers);
        setMailAssignedEmail(r.assigned_manager_email);
        const assigned = r.assigned_manager_email?.trim().toLowerCase() ?? '';
        const match = r.managers.find(
          (m) => m.email.trim().toLowerCase() === assigned
        );
        if (match) setMailRecipientEmail(match.email);
        else setMailRecipientEmail('');
      } finally {
        setMailLoadingCtx(false);
      }
    })();
  }, [tab]);

  const loadTeamPresence = useCallback(async () => {
    setPresenceLoading(true);
    setPresenceError(null);
    try {
      const r = await window.api.getTeamPresence();
      if (!r.ok) {
        setPresenceError(r.error);
        setPresenceMembers([]);
      } else {
        setPresenceMembers(r.members);
      }
    } finally {
      setPresenceLoading(false);
    }
  }, []);

  useEffect(() => {
    if (tab !== 'activity') return;
    void loadTeamPresence();
    const id = setInterval(() => void loadTeamPresence(), 25_000);
    return () => clearInterval(id);
  }, [tab, loadTeamPresence]);

  const applyMailPreset = (id: (typeof MAIL_PRESETS)[number]['id']) => {
    const p = MAIL_PRESETS.find((x) => x.id === id);
    if (!p) return;
    setMailSubject(p.subject);
    setMailBody(p.body);
    setMailMsg(null);
  };

  const handleMailSend = async () => {
    if (!mailSubject.trim() || !mailBody.trim() || !mailRecipientEmail.trim()) return;
    setMailSending(true);
    setMailMsg(null);
    try {
      const r = await window.api.mailSend({
        subject: mailSubject.trim(),
        body: mailBody.trim(),
        recipient_email: mailRecipientEmail.trim(),
      });
      if (r.ok) setMailMsg(`Sent to ${r.sent_to}`);
      else setMailMsg(r.error);
    } finally {
      setMailSending(false);
    }
  };

  const refreshSync = useCallback(async () => {
    const s = await window.api.getSyncStatus();
    setLastSyncAt(s.lastSyncAt);
  }, []);

  useEffect(() => {
    void (async () => {
      const snap = await window.api.getSessionState();
      setSession(snap);
      await refreshSync();
      const prefs = await window.api.getPreferences();
      setAutoTracking(prefs.autoTracking);
      setBreakReminder(prefs.breakReminderMinutes);
      const meta = await window.api.getAppMeta();
      setAppVersion(meta.version);
    })();
  }, [refreshSync]);

  useEffect(() => {
    const onSession = (snap: SessionSnapshotDTO) => setSession(snap);
    window.api.onSessionUpdate(onSession);
    return () => window.api.removeSessionListener();
  }, []);

  useEffect(() => {
    const offWarn = window.api.onIdleWarning((payload) => {
      setIdleWarn(payload);
      setIdleUiError(null);
    });
    const offRes = window.api.onIdleResolutionRequired(() => {
      setIdleWarn(null);
      setIdleResolutionOpen(true);
      setIdleUiError(null);
    });
    const offDismiss = window.api.onIdleResolutionDismissed(() => {
      setIdleWarn(null);
      setIdleResolutionOpen(false);
      setIdleWorkNote('');
      setIdleBreakReason('');
      setIdleBreakNote('');
      setIdleUiError(null);
    });
    return () => {
      offWarn();
      offRes();
      offDismiss();
    };
  }, []);

  useEffect(() => {
    if (session?.headerLabel === 'Confirm activity') {
      setIdleResolutionOpen(true);
      setIdleWarn(null);
    }
  }, [session?.headerLabel]);

  useEffect(() => {
    if (session && !session.idleStreakWallClockActive && idleWarn) {
      setIdleWarn(null);
    }
  }, [session?.idleStreakWallClockActive, idleWarn, session]);

  useEffect(() => {
    const id = setInterval(() => setNowTick(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  const origin = dashboardOrigin(apiBaseUrl);

  const handleSyncNow = async () => {
    setSyncing(true);
    try {
      await window.api.forceSync();
      await refreshSync();
    } finally {
      setTimeout(() => setSyncing(false), 400);
    }
  };

  const openBreakSelection = () => {
    setBreakFormError(null);
    setBreakReason('');
    setBreakDescription('');
    setBreakFlow(true);
  };

  const handleBackFromBreak = () => {
    setBreakFlow(false);
    setBreakFormError(null);
  };

  const handleConfirmBreak = async () => {
    if (!breakReason.trim()) {
      setBreakFormError('Please select a reason for your break.');
      return;
    }
    await window.api.startBreakDetails({
      reason: breakReason,
      description: breakDescription,
    });
    setBreakFlow(false);
    setBreakFormError(null);
  };

  const handleFinishDay = async () => {
    await window.api.finishDay();
    setBreakFlow(false);
    setBreakFormError(null);
  };

  const handleToggleAuto = async (next: boolean) => {
    setAutoTracking(next);
    await window.api.savePreferences({ autoTracking: next });
  };

  const handleBreakReminder = async (v: number) => {
    setBreakReminder(v);
    await window.api.savePreferences({ breakReminderMinutes: v });
  };

  const headerTitle = session?.headerLabel ?? 'Working';
  const headerClock = formatHMS(session?.headerElapsedSeconds ?? 0);

  const dateStr = new Date().toLocaleDateString(undefined, {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    weekday: 'long',
  });

  const syncLabel =
    lastSyncAt != null
      ? `Synced @ ${new Date(lastSyncAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}. Syncs every 2 minutes.`
      : 'Not synced yet. Syncs every 2 minutes.';

  const idleWarnSecondsLeft = idleWarn
    ? Math.max(0, Math.ceil((idleWarn.deadlineMs - nowTick) / 1000))
    : 0;

  const handleIdleConfirmWork = async () => {
    const note = idleWorkNote.trim();
    if (!note) {
      setIdleUiError('Describe what you were working on (meeting, offline work, etc.).');
      return;
    }
    setIdleSubmitting(true);
    setIdleUiError(null);
    try {
      await window.api.idleResolveWork({ description: note });
      setIdleResolutionOpen(false);
      setIdleWorkNote('');
    } catch (e) {
      setIdleUiError(e instanceof Error ? e.message : 'Could not save.');
    } finally {
      setIdleSubmitting(false);
    }
  };

  const handleIdleConfirmBreak = async () => {
    if (!idleBreakReason.trim()) {
      setIdleUiError('Select a reason for your break.');
      return;
    }
    setIdleSubmitting(true);
    setIdleUiError(null);
    try {
      await window.api.idleResolveBreak({
        reason: idleBreakReason,
        description: idleBreakNote.trim(),
      });
      setIdleResolutionOpen(false);
      setIdleBreakReason('');
      setIdleBreakNote('');
    } catch (e) {
      setIdleUiError(e instanceof Error ? e.message : 'Could not save.');
    } finally {
      setIdleSubmitting(false);
    }
  };

  return (
    <div className="relative flex h-full flex-col overflow-hidden rounded-xl border border-ea-muted/40 bg-white font-sans text-ea-deep shadow-lg shadow-ea-deep/10">
      <div className="draggable flex shrink-0 items-center gap-2 border-b border-ea-soft bg-gradient-to-r from-ea-soft/60 to-white px-2 pb-1.5 pt-1.5">
        <button
          type="button"
          className="no-drag flex h-7 w-8 shrink-0 items-center justify-center rounded-md text-ea-muted transition-colors hover:bg-ea-soft/80 hover:text-ea-deep"
          style={{ WebkitAppRegion: 'no-drag' } as CSSProperties}
          onMouseDown={(e) => e.stopPropagation()}
          onClick={() => void window.api.minimizeWindow()}
          aria-label="Minimize"
        >
          <svg className="h-2.5 w-2.5" viewBox="0 0 12 12" aria-hidden>
            <path fill="currentColor" d="M0 5h12v2H0z" />
          </svg>
        </button>
        <AppLogo className="no-drag h-7 w-7 shrink-0 opacity-95" />
        <span className="flex-1 text-center text-[11px] font-medium tracking-wide text-ea-primaryDark">
          {dateStr}
        </span>
        <span className="w-[72px] shrink-0" aria-hidden />
      </div>

      <div className="draggable bg-gradient-to-br from-ea-deep via-ea-primaryDark to-ea-primary px-4 py-3 text-center shadow-inner">
        <p className="text-base font-semibold tracking-wide text-white drop-shadow-sm">
          {headerTitle} — {headerClock}
        </p>
      </div>

      <div className="no-drag min-h-0 flex-1 overflow-y-auto px-3 pb-2 pt-4">
        {signOutError ? (
          <div
            role="alert"
            className="mb-3 flex items-start gap-2 rounded-lg border border-red-200 bg-red-50/90 px-2 py-2 text-xs text-red-800"
          >
            <span className="min-w-0 flex-1">{signOutError}</span>
            {onDismissSignOutError ? (
              <button
                type="button"
                className="shrink-0 font-medium text-red-700 underline"
                onClick={() => onDismissSignOutError()}
              >
                Dismiss
              </button>
            ) : null}
          </div>
        ) : null}
        {breakFlow ? (
          <div className="space-y-5 pb-2">
            <div className="flex items-center gap-2 border-b border-ea-soft pb-3">
              <button
                type="button"
                className="no-drag text-2xl leading-none text-ea-primary transition-transform hover:scale-105 hover:text-ea-primaryDark"
                onClick={handleBackFromBreak}
                aria-label="Back"
              >
                ←
              </button>
              <h2 className="flex-1 text-center text-lg font-semibold text-ea-primaryDark">
                Select option
              </h2>
              <span className="w-8" />
            </div>

            <div className="space-y-2 text-sm text-ea-deep">
              <label className="flex flex-wrap items-center gap-2">
                <span>I am taking a break for</span>
                <select
                  value={breakReason}
                  onChange={(e) => {
                    setBreakReason(e.target.value);
                    setBreakFormError(null);
                  }}
                  className="min-w-[10rem] flex-1 rounded-lg border border-ea-muted/60 bg-white px-2 py-2 text-ea-deep shadow-sm transition-colors focus:border-ea-primary focus:outline-none"
                >
                  <option value="">Select Reason</option>
                  {BREAK_REASONS.map((r) => (
                    <option key={r} value={r}>
                      {r}
                    </option>
                  ))}
                </select>
              </label>
              <p className="text-xs text-ea-muted">
                Break time is recorded as idle time for productivity reporting.
              </p>
            </div>

            <div className="space-y-1">
              <label className="text-sm text-ea-primaryDark">
                Please give the description:
              </label>
              <input
                type="text"
                value={breakDescription}
                onChange={(e) => setBreakDescription(e.target.value)}
                className="w-full rounded-lg border border-ea-muted/60 px-3 py-2 text-sm text-ea-deep shadow-sm transition-colors focus:border-ea-primary focus:outline-none"
                placeholder="Optional context for your team"
              />
            </div>

            {breakFormError && (
              <p className="text-sm text-red-600">{breakFormError}</p>
            )}

            <div className="grid grid-cols-2 gap-3 pt-2">
              <button
                type="button"
                onClick={() => void handleConfirmBreak()}
                className="no-drag flex flex-col items-center justify-center gap-1 rounded-xl bg-ea-primary px-3 py-4 text-sm font-semibold text-white shadow-md transition-transform hover:scale-[1.02] hover:bg-ea-primaryDark active:scale-[0.98]"
              >
                <span className="text-xl">☕</span>
                Take Break
              </button>
              <button
                type="button"
                onClick={() => void handleFinishDay()}
                className="no-drag flex flex-col items-center justify-center gap-1 rounded-xl bg-red-600 px-3 py-4 text-sm font-semibold text-white shadow-md transition-transform hover:scale-[1.02] hover:bg-red-700 active:scale-[0.98]"
              >
                <span className="text-xl">🚶</span>
                Finish the day
              </button>
            </div>
          </div>
        ) : (
          <div key={tab} className="animate-ea-tab-in">
          <>
        {tab === 'home' && (
          <div className="flex flex-col gap-6">
            <h1 className="text-xl font-semibold tracking-tight text-ea-deep">
              Welcome, {welcomeName(userEmail)}
            </h1>
            <div className="flex justify-between gap-3">
              <div className="min-w-0 space-y-3 text-sm text-ea-primaryDark">
                <p>
                  Worked{' '}
                  <span className="font-semibold tabular-nums text-ea-deep">
                    {formatMinutesAsHoursMinutes(session?.workedMinutes ?? 0)}
                  </span>
                </p>
                <p>
                  Idle{' '}
                  <span className="font-semibold tabular-nums text-ea-deep">
                    {formatMinutesAsHoursMinutes(session?.idleMinutes ?? 0)}
                  </span>
                </p>
                <p className="text-ea-muted">
                  Started at {session?.startedAtFormatted ?? '—'}
                </p>
                <button
                  type="button"
                  className="font-semibold text-ea-primary transition-colors hover:text-ea-primaryDark hover:underline"
                  onClick={() =>
                    session?.onBreak
                      ? void window.api.toggleBreak()
                      : openBreakSelection()
                  }
                >
                  {session?.onBreak ? 'End break' : 'Take break'}
                </button>
              </div>
              <div className="flex shrink-0 flex-col items-center gap-2">
                <AppLogo className="h-12 w-12 opacity-90 drop-shadow-sm" />
                <button
                  type="button"
                  onClick={() =>
                    session?.onBreak ? undefined : openBreakSelection()
                  }
                  disabled={Boolean(session?.onBreak)}
                  className="no-drag flex h-24 w-24 shrink-0 flex-col items-center justify-center rounded-full bg-gradient-to-br from-ea-primary to-ea-primaryDark px-1 shadow-lg shadow-ea-deep/25 transition-transform hover:scale-[1.03] hover:brightness-105 active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-40"
                  aria-label={
                    session?.onBreak
                      ? 'On break'
                      : 'Pause — select break option'
                  }
                >
                  {session?.onBreak ? (
                    <span className="text-xs font-semibold text-white">On break</span>
                  ) : (
                    <svg className="h-10 w-10 text-white" viewBox="0 0 24 24" fill="currentColor">
                      <path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z" />
                    </svg>
                  )}
                </button>
              </div>
            </div>
          </div>
        )}

        {tab === 'time' && (
          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-left text-xs">
              <thead>
                <tr className="border-b border-ea-muted/40 text-ea-muted">
                  <th className="pb-2 pr-2 font-medium">Start time</th>
                  <th className="pb-2 pr-2 font-medium">End time</th>
                  <th className="pb-2 pr-2 font-medium">Activity Status</th>
                  <th className="pb-2 font-medium">Duration</th>
                </tr>
              </thead>
              <tbody>
                {(session?.segments ?? []).map((seg) => (
                  <tr key={seg.id} className={`border-b border-ea-soft/80 ${segmentRowClass(seg.activity)}`}>
                    <td className="py-2 pr-2">{formatClock(seg.start)}</td>
                    <td className="py-2 pr-2">
                      {seg.end ? formatClock(seg.end) : ''}
                    </td>
                    <td className="py-2 pr-2 align-top">
                      <div className="font-medium text-ea-deep">{seg.activity}</div>
                      {seg.note ? (
                        <div className="mt-0.5 max-w-[140px] text-[10px] leading-snug text-ea-muted">
                          {seg.note}
                        </div>
                      ) : null}
                    </td>
                    <td className="py-2">{formatSegmentDuration(seg, nowTick)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {tab === 'activity' && (
          <div className="space-y-3 pb-1">
            <h2 className="text-sm font-semibold text-ea-deep">Team activity</h2>
            <p className="text-[10px] leading-snug text-ea-muted">
              Status reflects synced desktop activity (updates every ~25s). Admins assign teams in the web admin Reporting tab.
            </p>
            {presenceLoading && presenceMembers.length === 0 ? (
              <p className="text-xs text-ea-muted">Loading…</p>
            ) : null}
            {presenceError ? (
              <p className="text-xs text-red-600">{presenceError}</p>
            ) : null}
            {TEAM_SECTIONS.map(({ code, label }) => {
              const list = presenceMembers.filter((m) => m.team === code);
              return (
                <div
                  key={label}
                  className="rounded-lg border border-ea-soft bg-ea-soft/40 px-2.5 py-2"
                >
                  <h3 className="text-[11px] font-semibold uppercase tracking-wide text-ea-muted">
                    {label}
                  </h3>
                  {list.length === 0 ? (
                    <p className="mt-1 text-[10px] text-ea-muted/80">No members</p>
                  ) : (
                    <ul className="mt-1.5 space-y-2">
                      {list.map((m) => (
                        <li
                          key={m.user_id}
                          className="flex items-start justify-between gap-2 border-b border-ea-soft/80 pb-2 last:border-0 last:pb-0"
                        >
                          <span className="min-w-0 flex-1">
                            <span className="block truncate text-xs font-medium text-ea-deep">
                              {displayShortName(m.email)}
                            </span>
                            <span className="block truncate text-[10px] text-ea-muted">
                              {m.email}
                            </span>
                          </span>
                          <span
                            className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-medium ${presenceBadgeClass(m.state)}`}
                          >
                            {presenceLabel(m.state)}
                          </span>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              );
            })}
          </div>
        )}

        {tab === 'hours' && (
          <div className="rounded-lg border border-ea-soft bg-ea-soft/50 p-6 text-center text-sm text-ea-primaryDark">
            <p className="font-medium text-ea-deep">Hours summary</p>
            <p className="mt-2">
              Weekly totals and exports will appear here. Tracking continues in the
              background.
            </p>
          </div>
        )}

        {tab === 'mail' && (
          <div className="space-y-4 text-sm">
            <p className="font-medium text-ea-deep">Mail your manager</p>
            {mailLoadingCtx ? (
              <p className="text-ea-muted">Loading…</p>
            ) : mailManagers.length === 0 ? (
              <p className="text-xs text-amber-800">{mailMsg ?? 'No managers configured.'}</p>
            ) : (
              <>
                <label className="block text-xs font-medium text-ea-primaryDark">
                  Recipient manager
                </label>
                <select
                  className="w-full rounded-lg border border-ea-muted/60 bg-white px-2 py-2 text-xs text-ea-deep shadow-sm focus:border-ea-primary focus:outline-none"
                  value={mailRecipientEmail}
                  onChange={(e) => {
                    setMailRecipientEmail(e.target.value);
                    setMailMsg(null);
                  }}
                >
                  <option value="">Select manager…</option>
                  {mailManagers.map((m) => (
                    <option key={m.email} value={m.email}>
                      {m.name} — {m.email}
                    </option>
                  ))}
                </select>
                {mailAssignedEmail ? (
                  <p className="text-[10px] text-ea-muted">
                    Assigned: {mailAssignedEmail}
                  </p>
                ) : null}
              </>
            )}
            <div className="flex flex-wrap gap-2">
              {MAIL_PRESETS.map((p) => (
                <button
                  key={p.id}
                  type="button"
                  className="rounded-full border border-ea-soft bg-ea-soft/50 px-2 py-1 text-[11px] font-medium text-ea-primaryDark transition-transform hover:scale-105 hover:bg-ea-soft"
                  onClick={() => applyMailPreset(p.id)}
                >
                  {p.label}
                </button>
              ))}
            </div>
            <input
              className="w-full rounded-lg border border-ea-muted/60 px-2 py-1.5 text-xs text-ea-deep shadow-sm focus:border-ea-primary focus:outline-none"
              placeholder="Subject"
              value={mailSubject}
              onChange={(e) => setMailSubject(e.target.value)}
              disabled={!mailManagers.length}
            />
            <textarea
              className="min-h-[120px] w-full resize-y rounded-lg border border-ea-muted/60 px-2 py-1.5 font-mono text-[11px] text-ea-deep shadow-sm focus:border-ea-primary focus:outline-none"
              placeholder="Message"
              value={mailBody}
              onChange={(e) => setMailBody(e.target.value)}
              disabled={!mailManagers.length}
            />
            {mailMsg && !mailLoadingCtx && mailManagers.length > 0 && (
              <p
                className={`text-xs ${mailMsg.startsWith('Sent') ? 'text-green-700' : 'text-red-600'}`}
              >
                {mailMsg}
              </p>
            )}
            <button
              type="button"
              disabled={
                !mailManagers.length ||
                !mailRecipientEmail.trim() ||
                mailSending ||
                !mailSubject.trim() ||
                !mailBody.trim()
              }
              onClick={() => void handleMailSend()}
              className="w-full rounded-lg bg-ea-primary py-2 text-xs font-semibold text-white shadow-md transition-transform hover:scale-[1.01] hover:bg-ea-primaryDark disabled:opacity-40"
            >
              {mailSending ? 'Sending…' : 'Send to manager'}
            </button>
          </div>
        )}

        {tab === 'more' && (
          <div className="space-y-5 text-sm">
            <div className="flex gap-3 border-b border-ea-soft pb-4">
              <span className="text-2xl text-ea-primary">⟳</span>
              <div>
                <p className="text-ea-deep">{syncLabel}</p>
                <button
                  type="button"
                  className="mt-1 font-medium text-ea-primary transition-colors hover:text-ea-primaryDark hover:underline"
                  onClick={handleSyncNow}
                  disabled={syncing}
                >
                  {syncing ? 'Syncing…' : 'Sync Now'}
                </button>
              </div>
            </div>

            <button
              type="button"
              className="flex w-full items-center gap-3 rounded-lg border-b border-ea-soft pb-4 text-left text-ea-deep transition-colors hover:bg-ea-soft/50"
              onClick={onLogout}
            >
              <span className="text-xl">⎋</span>
              Sign out
            </button>
            {!agentLockedDown && (
              <button
                type="button"
                className="flex w-full items-center gap-3 rounded-lg border-b border-ea-soft pb-4 text-left text-ea-deep transition-colors hover:bg-ea-soft/50"
                onClick={() => window.close()}
              >
                <span className="text-xl">🚪</span>
                Exit
              </button>
            )}

            <div className="flex items-center justify-between gap-3 border-b border-ea-soft pb-4">
              <span className="text-ea-primaryDark">
                I would like to start my tracking automatically
              </span>
              <button
                type="button"
                role="switch"
                aria-checked={autoTracking}
                onClick={() => void handleToggleAuto(!autoTracking)}
                className={`relative h-7 w-12 shrink-0 rounded-full transition-colors ${
                  autoTracking ? 'bg-ea-primary' : 'bg-ea-muted/40'
                }`}
              >
                <span
                  className={`absolute top-0.5 h-6 w-6 rounded-full bg-white shadow transition-transform duration-200 ease-out ${
                    autoTracking ? 'left-6' : 'left-0.5'
                  }`}
                />
              </button>
            </div>

            <div className="flex flex-wrap items-center gap-2 border-b border-ea-soft pb-4">
              <span className="text-ea-primaryDark">Remind me to resume break after</span>
              <select
                value={breakReminder}
                onChange={(e) =>
                  void handleBreakReminder(Number(e.target.value))
                }
                className="rounded-lg border border-ea-muted/60 bg-white px-2 py-1 text-ea-deep shadow-sm focus:border-ea-primary focus:outline-none"
              >
                {[5, 10, 15, 30, 45, 60].map((m) => (
                  <option key={m} value={m}>
                    {m} minutes
                  </option>
                ))}
              </select>
            </div>

            <p className="text-[11px] leading-relaxed text-ea-muted">
              Version — {appVersion || '—'} · Last Active Before —{' '}
              {formatMinutesAsHoursMinutes(session?.idleMinutes ?? 0)} idle · Server Time —{' '}
              {new Date().toLocaleString()} · Timeout — 5 min
            </p>
          </div>
        )}
          </>
          </div>
        )}
      </div>

      <nav className="no-drag shrink-0 border-t border-ea-soft bg-gradient-to-t from-ea-soft/30 to-white px-1 pb-1 pt-2">
        <div className="grid grid-cols-3 gap-y-1 gap-x-0.5 text-center text-[10px] font-semibold leading-tight">
          {(
            [
              ['home', 'Home'],
              ['time', 'Time'],
              ['activity', 'Activity'],
              ['hours', 'Hours'],
              ['mail', 'Mail'],
              ['more', 'More'],
            ] as const
          ).map(([id, label]) => (
            <button
              key={id}
              type="button"
              onClick={() => {
                setBreakFlow(false);
                setTab(id);
              }}
              className={`rounded-lg py-2 transition-all duration-200 ease-out ${
                tab === id
                  ? 'bg-ea-primary text-white shadow-md shadow-ea-deep/20 scale-[1.02]'
                  : id === 'more'
                    ? 'text-red-600 hover:bg-red-50'
                    : 'text-ea-primaryDark hover:bg-ea-soft/70 active:scale-[0.98]'
              }`}
            >
              {label}
            </button>
          ))}
        </div>
        <div className="mt-2 flex justify-center gap-2 border-t border-ea-soft/80 pt-2 text-xs">
          <button
            type="button"
            className="font-medium text-ea-primary transition-colors hover:text-ea-primaryDark hover:underline"
            onClick={() =>
              void window.api.openDashboard(`${origin}/dashboard`)
            }
          >
            My Dashboard
          </button>
          <span className="text-ea-muted">|</span>
          <button
            type="button"
            className="font-medium text-ea-primary transition-colors hover:text-ea-primaryDark hover:underline"
            onClick={() =>
              void window.api.openDashboard(`${origin}/dashboard`)
            }
          >
            Go to edit time
          </button>
        </div>
      </nav>

      {idleWarn && !idleResolutionOpen && (
        <div
          className="no-drag fixed inset-0 z-[200] flex flex-col items-center justify-center bg-ea-deep/75 px-4 py-8 backdrop-blur-sm"
          role="dialog"
          aria-modal="true"
          aria-labelledby="idle-warn-title"
        >
          <div className="w-full max-w-sm rounded-xl border border-ea-muted/60 bg-white px-5 py-5 shadow-2xl shadow-ea-deep/40 transition-opacity duration-200">
            <h2
              id="idle-warn-title"
              className="text-center text-lg font-semibold text-ea-deep"
            >
              No input detected
            </h2>
            <p className="mt-2 text-center text-sm text-ea-primaryDark">
              Confirm what you were doing before this session is marked idle.
              Resolution in{' '}
              <span className="font-mono font-semibold tabular-nums text-ea-primary">
                {formatHMS(idleWarnSecondsLeft)}
              </span>
              .
            </p>
          </div>
        </div>
      )}

      {idleResolutionOpen && (
        <div
          className="no-drag fixed inset-0 z-[210] flex flex-col items-center justify-center bg-ea-deep/80 px-3 py-8 backdrop-blur-sm"
          role="dialog"
          aria-modal="true"
          aria-labelledby="idle-res-title"
        >
          <div className="max-h-[90vh] w-full max-w-md overflow-y-auto rounded-xl border border-ea-muted/50 bg-white px-4 py-5 shadow-2xl shadow-ea-deep/30">
            <div className="mb-3 flex justify-center">
              <AppLogo className="h-11 w-11" />
            </div>
            <h2
              id="idle-res-title"
              className="text-center text-lg font-semibold text-ea-deep"
            >
              How should we record this time?
            </h2>
            <p className="mt-1 text-center text-xs text-ea-muted">
              You had no input for about five minutes. Choose whether this was
              work or a break.
            </p>

            {idleUiError && (
              <p className="mt-3 text-center text-sm text-red-600">{idleUiError}</p>
            )}

            <div className="mt-4 space-y-4 border-t border-ea-soft pt-4">
              <p className="text-sm font-medium text-ea-deep">Working</p>
              <label className="block text-xs text-ea-primaryDark">
                What were you doing? (required)
                <textarea
                  value={idleWorkNote}
                  onChange={(e) => {
                    setIdleWorkNote(e.target.value);
                    setIdleUiError(null);
                  }}
                  rows={3}
                  className="mt-1 w-full resize-none rounded-lg border border-ea-muted/60 px-3 py-2 text-sm text-ea-deep shadow-sm transition-colors focus:border-ea-primary focus:outline-none"
                  placeholder="e.g. Team meeting, deep focus without keyboard…"
                  disabled={idleSubmitting}
                />
              </label>
              <button
                type="button"
                disabled={idleSubmitting}
                onClick={() => void handleIdleConfirmWork()}
                className="w-full rounded-lg bg-ea-primary py-2.5 text-sm font-semibold text-white shadow-md transition-transform hover:scale-[1.01] hover:bg-ea-primaryDark disabled:opacity-50"
              >
                Count as working time
              </button>
            </div>

            <div className="mt-6 space-y-3 border-t border-ea-soft pt-4">
              <p className="text-sm font-medium text-ea-deep">Break</p>
              <label className="block text-xs text-ea-primaryDark">
                Reason
                <select
                  value={idleBreakReason}
                  onChange={(e) => {
                    setIdleBreakReason(e.target.value);
                    setIdleUiError(null);
                  }}
                  className="mt-1 w-full rounded-lg border border-ea-muted/60 bg-white px-2 py-2 text-sm text-ea-deep shadow-sm focus:border-ea-primary focus:outline-none"
                  disabled={idleSubmitting}
                >
                  <option value="">Select reason</option>
                  {BREAK_REASONS.map((r) => (
                    <option key={r} value={r}>
                      {r}
                    </option>
                  ))}
                </select>
              </label>
              <label className="block text-xs text-ea-primaryDark">
                Note (optional)
                <input
                  type="text"
                  value={idleBreakNote}
                  onChange={(e) => setIdleBreakNote(e.target.value)}
                  className="mt-1 w-full rounded-lg border border-ea-muted/60 px-3 py-2 text-sm text-ea-deep shadow-sm focus:border-ea-primary focus:outline-none"
                  disabled={idleSubmitting}
                />
              </label>
              <button
                type="button"
                disabled={idleSubmitting}
                onClick={() => void handleIdleConfirmBreak()}
                className="w-full rounded-lg bg-ea-primaryDark py-2.5 text-sm font-semibold text-white shadow-md transition-transform hover:scale-[1.01] hover:bg-ea-deep disabled:opacity-50"
              >
                Record as break
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
