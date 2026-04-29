import db from './database';

export interface ActivityLog {
  userId: string;
  activityScore: number;
  status: string;
  keyboardEntropy: number;
  mouseEntropy: number;
  activeApp: string | null;
  timestamp: string;
}

export function enqueueActivity(log: ActivityLog) {
  try {
    const stmt = db.prepare(`
      INSERT INTO activity_queue (
        user_id, activity_score, status, keyboard_entropy, mouse_entropy, active_app, timestamp
      ) VALUES (?, ?, ?, ?, ?, ?, ?)
    `);

    stmt.run(
      log.userId,
      log.activityScore,
      log.status,
      log.keyboardEntropy,
      log.mouseEntropy,
      log.activeApp,
      log.timestamp
    );
  } catch (error) {
    console.error('Failed to enqueue activity:', error);
  }
}