import db from './database';
import { net } from 'electron';
import axios from 'axios';
import { readAgentConfig } from './agentConfig';

const BATCH_SIZE = 50;
let isSyncing = false;
let lastSuccessfulSyncAt: number | null = null;

export function getLastSuccessfulSyncAt(): number | null {
  return lastSuccessfulSyncAt;
}

function trackBulkUrl(): string {
  const base = readAgentConfig().apiBaseUrl.replace(/\/$/, '');
  return `${base}/api/activity/track/bulk`;
}

export async function syncQueueToServer() {
  const token = readAgentConfig().accessToken;
  if (!token || isSyncing || !net.isOnline()) return;

  isSyncing = true;

  try {
    const records = db
      .prepare(`SELECT * FROM activity_queue ORDER BY timestamp ASC LIMIT ?`)
      .all(BATCH_SIZE) as {
      id: number;
      user_id: string;
      activity_score: number;
      status: string;
      keyboard_entropy: number;
      mouse_entropy: number;
      active_app: string | null;
      timestamp: string;
    }[];

    if (records.length === 0) {
      return;
    }

    const payload = records.map((r) => ({
      activity_score: r.activity_score,
      status: r.status,
      keyboard_entropy: r.keyboard_entropy,
      mouse_entropy: r.mouse_entropy,
      active_app: r.active_app,
      timestamp: r.timestamp,
    }));

    const response = await axios.post(
      trackBulkUrl(),
      { logs: payload },
      {
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
      }
    );

    if (response.status === 200 || response.status === 201) {
      const ids = records.map((r) => r.id);
      const deleteStmt = db.prepare(
        `DELETE FROM activity_queue WHERE id IN (${ids.map(() => '?').join(',')})`
      );
      deleteStmt.run(...ids);

      console.log(`Successfully synced ${records.length} records to server.`);
      lastSuccessfulSyncAt = Date.now();

      isSyncing = false;
      if (records.length === BATCH_SIZE) {
        setTimeout(() => void syncQueueToServer(), 1000);
      }
    }
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : String(error);
    console.error('Sync failed:', msg);
  } finally {
    isSyncing = false;
  }
}
