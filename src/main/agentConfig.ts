import fs from 'fs';
import path from 'path';
import { app } from 'electron';
import { normalizeApiBaseUrl } from './urlUtils';

export interface AgentConfig {
  apiBaseUrl: string;
  accessToken: string | null;
  userEmail: string | null;
  userId: string | null;
  /** Default true: enqueue activity samples each minute. */
  autoTracking?: boolean;
  /** Minutes — reminder to resume after break (UI only until notifications wired). */
  breakReminderMinutes?: number;
  /** When true, show main window on launch even if started with --hidden (HKLM Run). */
  showWindowOnStartup?: boolean;
}

function configPath(): string {
  return path.join(app.getPath('userData'), 'agent-config.json');
}

export function readAgentConfig(): AgentConfig {
  const envUrl = process.env.ENTERPRISE_API_URL?.trim();
  const envToken = process.env.ENTERPRISE_ACCESS_TOKEN?.trim();

  let fromFile: Partial<AgentConfig> = {};
  try {
    const raw = fs.readFileSync(configPath(), 'utf-8');
    fromFile = JSON.parse(raw) as Partial<AgentConfig>;
  } catch {
    // missing or invalid file
  }

  const rawUrl =
    envUrl || fromFile.apiBaseUrl || 'http://apitm.steorasystems.com';

  return {
    apiBaseUrl: normalizeApiBaseUrl(rawUrl),
    accessToken: envToken ?? fromFile.accessToken ?? null,
    userEmail: fromFile.userEmail ?? null,
    userId: fromFile.userId ?? null,
    autoTracking:
      typeof fromFile.autoTracking === 'boolean' ? fromFile.autoTracking : true,
    breakReminderMinutes:
      typeof fromFile.breakReminderMinutes === 'number'
        ? fromFile.breakReminderMinutes
        : 15,
    showWindowOnStartup:
      typeof fromFile.showWindowOnStartup === 'boolean'
        ? fromFile.showWindowOnStartup
        : false,
  };
}

export function writeAgentConfig(patch: Partial<AgentConfig>): AgentConfig {
  const cur = readAgentConfig();
  const next: AgentConfig = {
    apiBaseUrl: normalizeApiBaseUrl(patch.apiBaseUrl ?? cur.apiBaseUrl),
    accessToken:
      patch.accessToken !== undefined ? patch.accessToken : cur.accessToken,
    userEmail: patch.userEmail !== undefined ? patch.userEmail : cur.userEmail,
    userId: patch.userId !== undefined ? patch.userId : cur.userId,
    autoTracking:
      patch.autoTracking !== undefined ? patch.autoTracking : cur.autoTracking,
    breakReminderMinutes:
      patch.breakReminderMinutes !== undefined
        ? patch.breakReminderMinutes
        : cur.breakReminderMinutes,
    showWindowOnStartup:
      patch.showWindowOnStartup !== undefined
        ? patch.showWindowOnStartup
        : cur.showWindowOnStartup,
  };

  fs.writeFileSync(
    configPath(),
    JSON.stringify(
      {
        apiBaseUrl: next.apiBaseUrl,
        accessToken: next.accessToken,
        userEmail: next.userEmail,
        userId: next.userId,
        autoTracking: next.autoTracking,
        breakReminderMinutes: next.breakReminderMinutes,
        showWindowOnStartup: next.showWindowOnStartup,
      },
      null,
      2
    ),
    'utf-8'
  );

  return next;
}
