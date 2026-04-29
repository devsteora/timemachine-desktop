import { randomUUID } from 'crypto';
import fs from 'fs';
import path from 'path';
import { app } from 'electron';
import { readAgentConfig } from './agentConfig';
import { getTodayWorkedIdleMinutes } from './dailyActivityTotals';

export interface TimeSegment {
  id: string;
  start: number;
  end?: number;
  activity: string;
  note?: string;
}

let sessionStartedAt: number | null = null;
let isPaused = false;
let onBreak = false;
let segments: TimeSegment[] = [];

/** Minimum consecutive IDLE minutes (no keyboard/mouse in window) before session counts as away. */
export const INPUT_IDLE_THRESHOLD_MINUTES = 5;

/** Wall-clock ms from streak start to fire pre-warning (30s before 5m mark). */
export const IDLE_WARNING_AT_MS = 4 * 60_000 + 30_000;

/** Wall-clock ms from streak start to require Working/Break resolution. */
export const IDLE_RESOLUTION_AT_MS = 5 * 60_000;

/** Fallback: apply auto idle if resolution UI ignored (ms after resolution due). */
export const IDLE_RESOLUTION_FALLBACK_MS = 3 * 60_000;

/** Session segment when user had no input for long enough; counts as idle time. */
export const AUTO_IDLE_ACTIVITY = 'Idle — No input';

let consecutiveIdleMinutes = 0;

/** Start of current idle streak (wall clock), first minute of no input. */
let idleStreakWallClockMs: number | null = null;

/** True after 5m elapsed until user resolves or fallback applies auto idle. */
let idleResolutionPending = false;

/** True after 4m30 warning sent until streak resets or resolved. */
let idleWarningShown = false;

/** Minimum wall-clock gap (ms) to treat as sleep / offline (timers frozen). */
const OFFLINE_GAP_MS = 120_000;

const PERSIST_VERSION = 2 as const;

function sessionStatePath(): string {
  return path.join(app.getPath('userData'), 'session-state.json');
}

interface PersistedSessionV2 {
  version: typeof PERSIST_VERSION;
  userId: string | null;
  sessionStartedAt: number | null;
  isPaused: boolean;
  onBreak: boolean;
  segments: TimeSegment[];
  idleStreakWallClockMs: number | null;
  idleResolutionPending: boolean;
  idleWarningShown: boolean;
}

function resetIdleFlowState(): void {
  idleStreakWallClockMs = null;
  idleResolutionPending = false;
  idleWarningShown = false;
}

function isValidSegment(s: unknown): s is TimeSegment {
  if (!s || typeof s !== 'object') return false;
  const o = s as Record<string, unknown>;
  return (
    typeof o.id === 'string' &&
    typeof o.start === 'number' &&
    typeof o.activity === 'string' &&
    (o.end === undefined || typeof o.end === 'number') &&
    (o.note === undefined || typeof o.note === 'string')
  );
}

function persistCurrentSession(): void {
  try {
    const cfg = readAgentConfig();
    const payload: PersistedSessionV2 = {
      version: PERSIST_VERSION,
      userId: cfg.userId ?? null,
      sessionStartedAt,
      isPaused,
      onBreak,
      segments: segments.map((s) => ({ ...s })),
      idleStreakWallClockMs,
      idleResolutionPending,
      idleWarningShown,
    };
    fs.writeFileSync(
      sessionStatePath(),
      JSON.stringify(payload, null, 2),
      'utf-8'
    );
  } catch (e) {
    console.error('Failed to persist session state:', e);
  }
}

function clearSessionFile(): void {
  try {
    const p = sessionStatePath();
    if (fs.existsSync(p)) fs.unlinkSync(p);
  } catch (e) {
    console.error('Failed to remove session state file:', e);
  }
}

/**
 * Restores in-memory session from disk. Call only when the user is authenticated.
 * Returns false if there was nothing to restore or data was invalid / wrong user.
 */
export function restoreSessionFromDisk(expectedUserId: string | null): boolean {
  try {
    const p = sessionStatePath();
    if (!fs.existsSync(p)) return false;
    const raw = fs.readFileSync(p, 'utf-8');
    const data = JSON.parse(raw) as Partial<PersistedSessionV2> & {
      version?: number;
    };
    if (!Array.isArray(data.segments)) {
      clearSessionFile();
      return false;
    }
    if (data.userId !== expectedUserId) {
      clearSessionFile();
      return false;
    }
    if (typeof data.sessionStartedAt !== 'number') {
      clearSessionFile();
      return false;
    }
    if (!data.segments.every(isValidSegment)) {
      clearSessionFile();
      return false;
    }
    if (data.segments.length === 0) {
      clearSessionFile();
      return false;
    }
    sessionStartedAt = data.sessionStartedAt;
    isPaused = Boolean(data.isPaused);
    onBreak = Boolean(data.onBreak);
    segments = data.segments.map((s) => ({ ...s }));
    consecutiveIdleMinutes = 0;
    if (data.version === 2 && data.idleStreakWallClockMs !== undefined) {
      idleStreakWallClockMs =
        typeof data.idleStreakWallClockMs === 'number'
          ? data.idleStreakWallClockMs
          : null;
      idleResolutionPending = Boolean(data.idleResolutionPending);
      idleWarningShown = Boolean(data.idleWarningShown);
    } else {
      resetIdleFlowState();
    }
    return true;
  } catch {
    clearSessionFile();
    return false;
  }
}

function closeLatestOpen(now: number): void {
  const open = segments.find((s) => s.end === undefined);
  if (open) open.end = now;
}

function addSegment(activity: string, now: number, note?: string): void {
  closeLatestOpen(now);
  segments.unshift({
    id: randomUUID(),
    start: now,
    activity,
    ...(note ? { note } : {}),
  });
}

export function startSession(): void {
  const now = Date.now();
  sessionStartedAt = now;
  isPaused = false;
  onBreak = false;
  consecutiveIdleMinutes = 0;
  resetIdleFlowState();
  segments = [{ id: randomUUID(), start: now, activity: 'Working' }];
  persistCurrentSession();
}

export function resetSession(): void {
  sessionStartedAt = null;
  isPaused = false;
  onBreak = false;
  consecutiveIdleMinutes = 0;
  resetIdleFlowState();
  segments = [];
  clearSessionFile();
}

export function getBreakState(): boolean {
  return onBreak;
}

export function toggleBreak(): boolean {
  const now = Date.now();
  if (!sessionStartedAt) return false;
  consecutiveIdleMinutes = 0;
  resetIdleFlowState();
  onBreak = !onBreak;
  if (onBreak) {
    addSegment('Idle — Quick break', now);
  } else {
    addSegment('Working', now);
  }
  persistCurrentSession();
  return onBreak;
}

export function startBreakWithDetails(reason: string, description: string): void {
  const now = Date.now();
  if (!sessionStartedAt) return;
  consecutiveIdleMinutes = 0;
  resetIdleFlowState();
  const trimmed = reason.trim();
  if (!trimmed) return;
  onBreak = true;
  isPaused = false;
  const note = description.trim() || undefined;
  addSegment(`Idle — ${trimmed}`, now, note);
  persistCurrentSession();
}

export function togglePause(): boolean {
  const now = Date.now();
  if (!sessionStartedAt) return false;
  consecutiveIdleMinutes = 0;
  resetIdleFlowState();
  isPaused = !isPaused;
  if (isPaused) {
    addSegment('Paused', now);
  } else {
    addSegment('Working', now);
  }
  persistCurrentSession();
  return isPaused;
}

export function getPauseState(): boolean {
  return isPaused;
}

export function getIdleStreakWallClockMs(): number | null {
  return idleStreakWallClockMs;
}

export function getConsecutiveIdleMinutes(): number {
  return consecutiveIdleMinutes;
}

export function isIdleResolutionPending(): boolean {
  return idleResolutionPending;
}

export function setIdleResolutionPending(value: boolean): void {
  idleResolutionPending = value;
  persistCurrentSession();
}

export function wasIdleWarningShown(): boolean {
  return idleWarningShown;
}

export function setIdleWarningShown(value: boolean): void {
  idleWarningShown = value;
  persistCurrentSession();
}

/** Wall-clock ms until resolution prompt is due (streak start + 5m). */
export function getIdleResolutionDeadlineMs(): number | null {
  if (idleStreakWallClockMs == null) return null;
  return idleStreakWallClockMs + IDLE_RESOLUTION_AT_MS;
}

/**
 * When the machine sleeps, timers pause but open segments still grow with wall-clock
 * time once awake. Split the timeline so [from, to] counts as system sleep (idle).
 */
export function applyOfflineGap(from: number, to: number): void {
  if (!sessionStartedAt || to - from <= OFFLINE_GAP_MS) return;
  const open = segments.find((s) => s.end === undefined);
  if (!open) return;
  if (open.activity === 'Idle — System sleep') {
    open.end = to;
    persistCurrentSession();
    return;
  }
  const prevActivity = open.activity;
  const prevNote = open.note;
  closeLatestOpen(from);
  segments.unshift({
    id: randomUUID(),
    start: from,
    end: to,
    activity: 'Idle — System sleep',
  });
  segments.unshift({
    id: randomUUID(),
    start: to,
    activity: prevActivity,
    ...(prevNote !== undefined ? { note: prevNote } : {}),
  });
  consecutiveIdleMinutes = 0;
  resetIdleFlowState();
  persistCurrentSession();
}

/**
 * Each minute: if the tracker reports IDLE (no keyboard/mouse in that minute), bump streak.
 * After INPUT_IDLE_THRESHOLD_MINUTES consecutive IDLE minutes, switch session from Working to away idle,
 * unless idle resolution is pending (user must confirm first).
 */
export function applyInputIdlePolicy(rawStatus: string, now: number): void {
  if (!sessionStartedAt || onBreak || isPaused) {
    consecutiveIdleMinutes = 0;
    if (idleStreakWallClockMs != null) resetIdleFlowState();
    return;
  }

  const open = segments.find((s) => s.end === undefined);
  const inAutoIdle = open?.activity === AUTO_IDLE_ACTIVITY;

  if (rawStatus === 'IDLE') {
    const prevStreak = consecutiveIdleMinutes;
    consecutiveIdleMinutes += 1;
    if (prevStreak === 0) {
      idleStreakWallClockMs = now - 60_000;
      persistCurrentSession();
    }

    return;
  }

  consecutiveIdleMinutes = 0;
  if (idleStreakWallClockMs != null) resetIdleFlowState();
  if (inAutoIdle) {
    closeLatestOpen(now);
    segments.unshift({
      id: randomUUID(),
      start: now,
      activity: 'Working',
    });
    persistCurrentSession();
  }
}

/**
 * User confirms offline work (meeting, etc.) — ambiguous interval counts as working time with note.
 */
export function resolveIdlePeriodWork(description: string): void {
  const now = Date.now();
  if (!sessionStartedAt || !idleResolutionPending || idleStreakWallClockMs == null) {
    return;
  }
  const note = description.trim();
  if (!note) return;

  const open = segments.find((s) => s.end === undefined);
  const from = idleStreakWallClockMs;
  if (!open) return;
  if (open.activity === AUTO_IDLE_ACTIVITY) {
    const t0 = Math.max(open.start, from);
    closeLatestOpen(t0);
    segments.unshift({
      id: randomUUID(),
      start: t0,
      end: now,
      activity: 'Working',
      note,
    });
    segments.unshift({
      id: randomUUID(),
      start: now,
      activity: 'Working',
    });
    consecutiveIdleMinutes = 0;
    resetIdleFlowState();
    persistCurrentSession();
    return;
  }
  if (open.activity !== 'Working') return;

  const t = Math.max(open.start, from);
  closeLatestOpen(t);
  segments.unshift({
    id: randomUUID(),
    start: t,
    end: now,
    activity: 'Working',
    note,
  });
  segments.unshift({
    id: randomUUID(),
    start: now,
    activity: 'Working',
  });

  consecutiveIdleMinutes = 0;
  resetIdleFlowState();
  persistCurrentSession();
}

/**
 * User confirms break — elapsed ambiguous period is idle/break time with reason.
 */
export function resolveIdlePeriodBreak(reason: string, description: string): void {
  const now = Date.now();
  if (!sessionStartedAt || !idleResolutionPending || idleStreakWallClockMs == null) {
    return;
  }
  const trimmed = reason.trim();
  if (!trimmed) return;
  const note = description.trim() || undefined;

  const open = segments.find((s) => s.end === undefined);
  const from = idleStreakWallClockMs;
  if (!open) return;

  onBreak = true;
  isPaused = false;

  if (open.activity === AUTO_IDLE_ACTIVITY) {
    const t0 = Math.max(open.start, from);
    closeLatestOpen(t0);
    segments.unshift({
      id: randomUUID(),
      start: t0,
      end: now,
      activity: `Idle — ${trimmed}`,
      ...(note ? { note } : {}),
    });
    segments.unshift({
      id: randomUUID(),
      start: now,
      activity: `Idle — ${trimmed}`,
      ...(note ? { note } : {}),
    });
    consecutiveIdleMinutes = 0;
    resetIdleFlowState();
    persistCurrentSession();
    return;
  }
  if (open.activity !== 'Working') return;

  const t = Math.max(open.start, from);
  closeLatestOpen(t);
  segments.unshift({
    id: randomUUID(),
    start: t,
    end: now,
    activity: `Idle — ${trimmed}`,
    ...(note ? { note } : {}),
  });
  segments.unshift({
    id: randomUUID(),
    start: now,
    activity: `Idle — ${trimmed}`,
    ...(note ? { note } : {}),
  });

  consecutiveIdleMinutes = 0;
  resetIdleFlowState();
  persistCurrentSession();
}

/** If user ignores resolution, apply same outcome as automatic away idle. */
export function applyIdleResolutionFallback(): void {
  if (!sessionStartedAt || !idleResolutionPending) {
    return;
  }
  const open = segments.find((s) => s.end === undefined);
  if (!open) {
    resetIdleFlowState();
    persistCurrentSession();
    return;
  }
  if (open.activity === AUTO_IDLE_ACTIVITY) {
    resetIdleFlowState();
    persistCurrentSession();
    return;
  }
  if (open.activity !== 'Working') {
    resetIdleFlowState();
    persistCurrentSession();
    return;
  }
  const from = idleStreakWallClockMs ?? open.start;
  const idleStartedAt = Math.max(open.start, from);
  closeLatestOpen(idleStartedAt);
  segments.unshift({
    id: randomUUID(),
    start: idleStartedAt,
    activity: AUTO_IDLE_ACTIVITY,
  });
  consecutiveIdleMinutes = 0;
  resetIdleFlowState();
  persistCurrentSession();
}

export function finishDay(): void {
  resetSession();
  startSession();
}

export interface SessionSnapshot {
  sessionStartedAt: number | null;
  isPaused: boolean;
  onBreak: boolean;
  headerLabel: string;
  headerElapsedSeconds: number;
  /** Active + suspicious minutes in the current IST reporting period (6:00 PM–6:00 PM; see dailyActivityTotals). */
  workedMinutes: number;
  /** Idle minutes in that same period from minute logs. */
  idleMinutes: number;
  segments: TimeSegment[];
  startedAtFormatted: string | null;
  /** True while no-input streak is active (wall-clock anchor set). */
  idleStreakWallClockActive: boolean;
}

function segmentSeconds(seg: TimeSegment, now: number): number {
  const end = seg.end ?? now;
  return Math.max(0, (end - seg.start) / 1000);
}

function isWorkingActivity(activity: string): boolean {
  return activity === 'Working';
}

export function getSessionSnapshot(): SessionSnapshot {
  const now = Date.now();

  let workingSeconds = 0;
  for (const seg of segments) {
    const dur = segmentSeconds(seg, now);
    if (isWorkingActivity(seg.activity)) workingSeconds += dur;
  }

  const todayTotals = getTodayWorkedIdleMinutes();

  let headerLabel = 'Working';
  if (isPaused) headerLabel = 'Paused';
  else if (onBreak) headerLabel = 'On break';
  else if (idleResolutionPending) headerLabel = 'Confirm activity';
  else {
    const openSeg = segments.find((s) => s.end === undefined);
    if (openSeg?.activity === AUTO_IDLE_ACTIVITY) headerLabel = 'Away';
  }

  const startedStr = sessionStartedAt
    ? new Date(sessionStartedAt).toLocaleTimeString([], {
        hour: 'numeric',
        minute: '2-digit',
      })
    : null;

  return {
    sessionStartedAt,
    isPaused,
    onBreak,
    headerLabel,
    headerElapsedSeconds: Math.floor(workingSeconds),
    workedMinutes: todayTotals.workedMinutes,
    idleMinutes: todayTotals.idleMinutes,
    segments: segments.map((s) => ({ ...s })),
    startedAtFormatted: startedStr,
    idleStreakWallClockActive: idleStreakWallClockMs != null,
  };
}
