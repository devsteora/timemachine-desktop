import db from './database';

const IST_TIME_ZONE = 'Asia/Kolkata';
/** Minutes from IST midnight; period switches at 18:00 (6:00 PM IST). */
const SIX_PM_MINUTES = 18 * 60;

function getIstClockParts(ms: number): {
  year: number;
  month: number;
  day: number;
  /** Minute-of-day [0, 1439] from hour and minute (aligned to minute samples). */
  totalMinutesFromMidnight: number;
} {
  const d = new Date(ms);
  const fmt = new Intl.DateTimeFormat('en-GB', {
    timeZone: IST_TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  });
  const parts = fmt.formatToParts(d);
  const n: Record<string, string> = {};
  for (const p of parts) {
    if (p.type !== 'literal') n[p.type] = p.value;
  }
  const year = Number(n.year);
  const month = Number(n.month);
  const day = Number(n.day);
  const hour = Number(n.hour);
  const minute = Number(n.minute);
  return {
    year,
    month,
    day,
    totalMinutesFromMidnight: hour * 60 + minute,
  };
}

/** Convert IST wall time to UTC ms (Asia/Kolkata has no DST). */
function istWallTimeToUtcMs(
  year: number,
  month: number,
  day: number,
  hour: number,
  minute: number
): number {
  const pad = (x: number) => String(x).padStart(2, '0');
  return new Date(
    `${year}-${pad(month)}-${pad(day)}T${pad(hour)}:${pad(minute)}:00+05:30`
  ).getTime();
}

/**
 * Key for the reporting period used for Worked/Idle totals.
 * Each period starts at 6:00 PM IST and runs until just before the next 6:00 PM IST.
 * The key is `YYYY-MM-DD` of the calendar day in IST when that period *starts* (at 6 PM).
 */
export function istReportingPeriodKey(ms: number): string {
  const p = getIstClockParts(ms);
  const pad = (x: number) => String(x).padStart(2, '0');

  if (p.totalMinutesFromMidnight >= SIX_PM_MINUTES) {
    return `${p.year}-${pad(p.month)}-${pad(p.day)}`;
  }

  const noonMs = istWallTimeToUtcMs(p.year, p.month, p.day, 12, 0);
  const prevDayMs = noonMs - 86400000;
  const prev = getIstClockParts(prevDayMs);
  return `${prev.year}-${pad(prev.month)}-${pad(prev.day)}`;
}

export function istReportingPeriodKeyFromIso(iso: string): string {
  return istReportingPeriodKey(new Date(iso).getTime());
}

/** Same classification as typical server dashboards: ACTIVE + SUSPICIOUS count as active minutes; IDLE otherwise. */
export function isWorkedStatus(status: string): boolean {
  const u = status.toUpperCase();
  return u === 'ACTIVE' || u === 'SUSPICIOUS';
}

/**
 * Persist counts for rows successfully uploaded (mirrors what the server stores from track/bulk).
 * Call before deleting those rows from `activity_queue`.
 */
export function recordSyncedActivityRows(
  rows: { status: string; timestamp: string }[]
): void {
  if (rows.length === 0) return;

  const upsert = db.prepare(`
    INSERT INTO daily_activity_totals (date, worked_minutes, idle_minutes)
    VALUES (?, ?, ?)
    ON CONFLICT(date) DO UPDATE SET
      worked_minutes = daily_activity_totals.worked_minutes + excluded.worked_minutes,
      idle_minutes = daily_activity_totals.idle_minutes + excluded.idle_minutes
  `);

  const run = db.transaction(() => {
    for (const r of rows) {
      const dk = istReportingPeriodKeyFromIso(r.timestamp);
      const w = isWorkedStatus(r.status) ? 1 : 0;
      const i = w ? 0 : 1;
      upsert.run(dk, w, i);
    }
  });
  run();
}

/**
 * Totals for the current IST reporting period (6:00 PM–6:00 PM): synced minutes
 * persisted locally plus samples still in the outbound queue.
 */
export function getTodayWorkedIdleMinutes(): {
  workedMinutes: number;
  idleMinutes: number;
} {
  const periodKey = istReportingPeriodKey(Date.now());

  const persisted = db
    .prepare(
      `SELECT worked_minutes, idle_minutes FROM daily_activity_totals WHERE date = ?`
    )
    .get(periodKey) as
    | { worked_minutes: number; idle_minutes: number }
    | undefined;

  let worked = persisted?.worked_minutes ?? 0;
  let idle = persisted?.idle_minutes ?? 0;

  const pending = db
    .prepare(`SELECT status, timestamp FROM activity_queue`)
    .all() as { status: string; timestamp: string }[];

  for (const r of pending) {
    if (istReportingPeriodKeyFromIso(r.timestamp) !== periodKey) continue;
    if (isWorkedStatus(r.status)) worked += 1;
    else idle += 1;
  }

  return { workedMinutes: worked, idleMinutes: idle };
}
