import { evaluateActivityMinute } from './activityTracker';

export type MinuteEval = ReturnType<typeof evaluateActivityMinute>;

/** After this many flagged (SUSPICIOUS) minutes in the session, further SUSPICIOUS samples map to IDLE. */
const FLAGGED_CAP_MINUTES = 5;

/** Total SUSPICIOUS minutes recorded this session (until reset). */
let totalSuspiciousMinutes = 0;

/**
 * Once cumulative flagged time exceeds `FLAGGED_CAP_MINUTES`, every subsequent
 * minute that would be SUSPICIOUS is stored and reported as IDLE so it counts
 * toward idle time in the dashboard.
 */
export function applyFlaggedToIdlePolicy(raw: MinuteEval): MinuteEval {
  if (raw.status === 'SUSPICIOUS') {
    totalSuspiciousMinutes += 1;
    if (totalSuspiciousMinutes > FLAGGED_CAP_MINUTES) {
      return { ...raw, status: 'IDLE' };
    }
    return raw;
  }
  return raw;
}

export function resetFlaggedIdlePolicy(): void {
  totalSuspiciousMinutes = 0;
}
