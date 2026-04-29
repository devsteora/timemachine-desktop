import { app, BrowserWindow, ipcMain, Menu, Tray, nativeImage, powerMonitor, Notification, autoUpdater as electronAutoUpdater, shell } from 'electron';
import { join } from 'path';
import { electronApp, optimizer, is } from '@electron-toolkit/utils';
import { autoUpdater } from 'electron-updater';
import axios from 'axios';
import { initDB } from './database';
import { startTracking, evaluateActivityMinute } from './activityTracker';
import { enqueueActivity } from './queueService';
import { syncQueueToServer, getLastSuccessfulSyncAt } from './syncWorker';
import { readAgentConfig, writeAgentConfig } from './agentConfig';
import { normalizeApiBaseUrl } from './urlUtils';
import {
  startSession,
  resetSession,
  toggleBreak,
  getBreakState,
  togglePause,
  getPauseState,
  getSessionSnapshot,
  startBreakWithDetails,
  finishDay,
  restoreSessionFromDisk,
  applyOfflineGap,
  applyInputIdlePolicy,
  getIdleStreakWallClockMs,
  getConsecutiveIdleMinutes,
  wasIdleWarningShown,
  setIdleWarningShown,
  setIdleResolutionPending,
  isIdleResolutionPending,
  getIdleResolutionDeadlineMs,
  INPUT_IDLE_THRESHOLD_MINUTES,
  IDLE_WARNING_AT_MS,
  IDLE_RESOLUTION_AT_MS,
  IDLE_RESOLUTION_FALLBACK_MS,
  resolveIdlePeriodWork,
  resolveIdlePeriodBreak,
  applyIdleResolutionFallback,
} from './sessionTracker';
import { applyFlaggedToIdlePolicy, resetFlaggedIdlePolicy } from './activityPolicy';

let mainWindow: BrowserWindow;
let tray: Tray | null = null;

/** Reflects last minimize/restore for idle prompts (also cross-check isMinimized()). */
let mainWindowMinimizedHint = false;

/** Wall-clock anchor for the 1-minute activity loop; used to detect sleep (frozen timers). */
let lastActivityIntervalAnchorMs = Date.now();

function reconcileSleepGap(now: number): void {
  applyOfflineGap(lastActivityIntervalAnchorMs, now);
  lastActivityIntervalAnchorMs = now;
}

function tickIdleWallClockFlow(): void {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  const cfg = readAgentConfig();
  if (!cfg.accessToken || cfg.autoTracking === false) return;
  if (getBreakState() || getPauseState()) return;

  const now = Date.now();
  const start = getIdleStreakWallClockMs();
  if (start == null) return;

  const elapsed = now - start;
  const consecutive = getConsecutiveIdleMinutes();
  if (consecutive < 1) return;

  if (
    elapsed >= IDLE_WARNING_AT_MS &&
    !wasIdleWarningShown() &&
    !isIdleResolutionPending()
  ) {
    setIdleWarningShown(true);
    try {
      if (Notification.isSupported()) {
        new Notification({
          title: 'Enterprise Agent',
          body: 'No input detected. Confirm what you were doing in the app.',
        }).show();
      }
    } catch {
      /* ignore */
    }
    mainWindow.show();
    if (mainWindowMinimizedHint || mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.focus();
    const deadlineMs = start + IDLE_RESOLUTION_AT_MS;
    mainWindow.webContents.send('idle-warning', {
      deadlineMs,
      startedAt: start,
    });
  }

  if (
    elapsed >= IDLE_RESOLUTION_AT_MS &&
    consecutive >= INPUT_IDLE_THRESHOLD_MINUTES &&
    !isIdleResolutionPending()
  ) {
    setIdleResolutionPending(true);
    mainWindow.show();
    if (mainWindowMinimizedHint || mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.focus();
    mainWindow.webContents.send('idle-resolution-required', {
      startedAt: start,
      now,
    });
  }

  const deadline = getIdleResolutionDeadlineMs();
  if (
    isIdleResolutionPending() &&
    deadline != null &&
    now > deadline + IDLE_RESOLUTION_FALLBACK_MS
  ) {
    applyIdleResolutionFallback();
    if (!mainWindow.isDestroyed()) {
      mainWindow.webContents.send('idle-resolution-dismissed', {});
    }
  }
}

/** Allows `before-quit` to proceed (updates / installer). */
let allowQuit = false;

/** In packaged builds the agent must stay running; dev builds can exit normally. */
function productionAgentLockdown(): boolean {
  return !is.dev;
}

function registerRunAtStartup(): void {
  try {
    app.setLoginItemSettings({
      openAtLogin: true,
      openAsHidden: true,
      enabled: true,
      path: process.execPath,
      // --hidden tells the app to start without showing the window (tray only).
      // On Windows the HKLM Run key written by installer.nsh also passes --hidden,
      // so this HKCU entry acts as a fallback for non-admin accounts.
      args: process.platform === 'win32' ? ['--hidden'] : undefined,
    });
  } catch (e) {
    console.error('Failed to register run at login:', e);
  }
}

/** Minimal valid PNG so Windows tray does not reject an empty image. */
function trayIconImage(): Electron.NativeImage {
  const onePxPng = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
    'base64'
  );
  return nativeImage.createFromBuffer(onePxPng);
}

function createTray(): void {
  if (!productionAgentLockdown() || tray) return;

  tray = new Tray(trayIconImage());
  tray.setToolTip('Enterprise Agent — monitoring active');
  const menu = Menu.buildFromTemplate([
    {
      label: 'Show window',
      click: () => {
        if (mainWindow) {
          mainWindow.show();
          mainWindow.focus();
        }
      },
    },
  ]);
  tray.setContextMenu(menu);
  tray.on('click', () => {
    if (mainWindow) {
      mainWindow.show();
      mainWindow.focus();
    }
  });
}

function createWindow(): void {
  const lock = productionAgentLockdown();

  mainWindow = new BrowserWindow({
    width: 380,
    height: 680,
    show: false,
    autoHideMenuBar: true,
    alwaysOnTop: true,
    frame: false,
    closable: !lock,
    minimizable: true,
    maximizable: false,
    skipTaskbar: false,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false,
      contextIsolation: true,
    },
  });

  if (lock) {
    mainWindow.on('close', (event) => {
      event.preventDefault();
      mainWindow.hide();
      createTray();
    });
  }

  mainWindow.on('ready-to-show', () => {
    // Don't show the window when launched via startup registry key or login item.
    // The agent runs silently in the system tray until the user clicks it.
    const startHidden =
      process.argv.includes('--hidden') ||
      app.getLoginItemSettings().wasOpenedAsHidden;
    if (startHidden && productionAgentLockdown()) {
      createTray();
      return;
    }
    mainWindow.show();
  });

  mainWindow.on('minimize', () => {
    mainWindowMinimizedHint = true;
  });
  mainWindow.on('restore', () => {
    mainWindowMinimizedHint = false;
  });

  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL']);
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'));
  }
}

const gotSingleInstanceLock = app.requestSingleInstanceLock();
if (!gotSingleInstanceLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.show();
      mainWindow.focus();
    }
  });

  app.whenReady().then(() => {
    electronApp.setAppUserModelId('com.enterprise.agent');
    app.on('browser-window-created', (_, window) => {
      optimizer.watchWindowShortcuts(window);
    });

    if (productionAgentLockdown()) {
      Menu.setApplicationMenu(null);
      registerRunAtStartup();
      electronAutoUpdater.on('before-quit-for-update', () => {
        allowQuit = true;
      });
      app.on('before-quit', (event) => {
        if (allowQuit) return;
        event.preventDefault();
      });
    }

    createWindow();
    // Ensure the tray icon is always present in production, even before the
    // user first interacts with the window.
    createTray();

    const cfgAtBoot = readAgentConfig();
    if (cfgAtBoot.accessToken) {
      const restored = restoreSessionFromDisk(cfgAtBoot.userId ?? null);
      if (!restored) {
        startSession();
      }
    }

    lastActivityIntervalAnchorMs = Date.now();

    powerMonitor.on('resume', () => {
      reconcileSleepGap(Date.now());
    });

    // Silent forced auto-update: download and install without prompting employees.
    autoUpdater.autoDownload = true;
    autoUpdater.autoInstallOnAppQuit = true;
    autoUpdater.on('update-downloaded', () => {
      // Allow the before-quit handler to pass so the installer can run.
      allowQuit = true;
      // isSilent=true, isForceRunAfter=true: restart the app after installing.
      autoUpdater.quitAndInstall(true, true);
    });
    autoUpdater.checkForUpdates().catch(() => {
      // Silently ignore update check failures (offline, no update server yet).
    });

    initDB();

    startTracking();

    setInterval(() => {
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('session-update', getSessionSnapshot());
      }
      tickIdleWallClockFlow();
    }, 1000);

    setInterval(() => {
      const now = Date.now();
      reconcileSleepGap(now);

      const cfg = readAgentConfig();
      if (cfg.autoTracking === false) {
        return;
      }
      let data = getBreakState()
        ? {
            activityScore: 0,
            status: 'IDLE',
            kbVariance: 0,
            mouseEntropy: 0,
          }
        : evaluateActivityMinute();

      if (!getBreakState()) {
        applyInputIdlePolicy(data.status, Date.now());
        data = applyFlaggedToIdlePolicy(data);
      }

      const userId = cfg.userId ?? 'pending-auth';

      enqueueActivity({
        userId,
        activityScore: data.activityScore,
        status: data.status,
        keyboardEntropy: data.kbVariance,
        mouseEntropy: data.mouseEntropy,
        activeApp: getBreakState() ? 'Break' : 'Desktop',
        timestamp: new Date().toISOString(),
      });

      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('status-update', data.status);
      }
    }, 60 * 1000);

    setInterval(() => {
      syncQueueToServer();
    }, 120 * 1000);

    syncQueueToServer();
  });

  app.on('window-all-closed', () => {
    if (!productionAgentLockdown() && process.platform !== 'darwin') {
      app.quit();
    }
  });
}

ipcMain.handle('force-sync', async () => {
  await syncQueueToServer();
  return { success: true };
});

ipcMain.handle('idle-resolve-work', async (_, payload: { description: string }) => {
  resolveIdlePeriodWork(payload.description);
  await syncQueueToServer();
  return { ok: true as const };
});

ipcMain.handle('idle-resolve-break', async (_, payload: { reason: string; description?: string }) => {
  resolveIdlePeriodBreak(payload.reason, payload.description ?? '');
  await syncQueueToServer();
  return { ok: true as const };
});

ipcMain.handle('window-minimize', (event) => {
  const win =
    BrowserWindow.fromWebContents(event.sender) ??
    (mainWindow && !mainWindow.isDestroyed() ? mainWindow : null);
  if (!win || win.isDestroyed()) return;
  win.setMinimizable(true);
  win.minimize();
});

ipcMain.handle('auth-get-state', async () => {
  const c = readAgentConfig();
  return {
    apiBaseUrl: c.apiBaseUrl,
    isAuthenticated: Boolean(c.accessToken),
    userEmail: c.userEmail,
    userId: c.userId,
    agentLockedDown: productionAgentLockdown(),
  };
});

ipcMain.handle(
  'auth-login',
  async (
    _,
    opts: { apiBaseUrl: string; email: string; password: string }
  ) => {
    const base = normalizeApiBaseUrl(opts.apiBaseUrl).replace(/\/$/, '');
    try {
      const { data } = await axios.post<{
        access_token: string;
        user: { id: string; email: string; role: string };
      }>(`${base}/api/auth/login`, {
        email: opts.email,
        password: opts.password,
      });
      writeAgentConfig({
        apiBaseUrl: base,
        accessToken: data.access_token,
        userEmail: data.user.email,
        userId: data.user.id,
      });
      startSession();
      lastActivityIntervalAnchorMs = Date.now();
      await syncQueueToServer();
      return { ok: true as const, user: data.user };
    } catch (e: unknown) {
      if (axios.isAxiosError(e)) {
        const detail = e.response?.data as { detail?: unknown } | undefined;
        const msg = detail?.detail;
        const text = Array.isArray(msg)
          ? msg.map((x) => JSON.stringify(x)).join(', ')
          : msg != null
            ? String(msg)
            : e.message;
        return { ok: false as const, error: text };
      }
      return {
        ok: false as const,
        error: e instanceof Error ? e.message : 'Login failed',
      };
    }
  }
);

ipcMain.handle('auth-logout', async () => {
  if (productionAgentLockdown()) {
    return {
      ok: false as const,
      error: 'Signing out is disabled for this deployment.',
    };
  }
  writeAgentConfig({
    accessToken: null,
    userEmail: null,
    userId: null,
  });
  resetSession();
  resetFlaggedIdlePolicy();
  lastActivityIntervalAnchorMs = Date.now();
  return { ok: true as const };
});

ipcMain.handle('toggle-break', async () => {
  const on = toggleBreak();
  await syncQueueToServer();
  return on;
});

ipcMain.handle('get-break-state', async () => getBreakState());

ipcMain.handle('toggle-pause', async () => togglePause());

ipcMain.handle(
  'start-break-details',
  async (_, payload: { reason: string; description: string }) => {
    startBreakWithDetails(payload.reason, payload.description);
    await syncQueueToServer();
    return { ok: true as const };
  }
);

ipcMain.handle('finish-day', async () => {
  finishDay();
  resetFlaggedIdlePolicy();
  lastActivityIntervalAnchorMs = Date.now();
  return { ok: true as const };
});

ipcMain.handle('get-session-state', async () => getSessionSnapshot());

ipcMain.handle('get-sync-status', async () => ({
  lastSyncAt: getLastSuccessfulSyncAt(),
  syncIntervalMs: 120_000,
}));

ipcMain.handle(
  'save-preferences',
  async (
    _,
    prefs: { autoTracking?: boolean; breakReminderMinutes?: number }
  ) => {
    writeAgentConfig(prefs);
    return { ok: true as const };
  }
);

ipcMain.handle('get-preferences', async () => {
  const c = readAgentConfig();
  return {
    autoTracking: c.autoTracking !== false,
    breakReminderMinutes: c.breakReminderMinutes ?? 15,
  };
});

ipcMain.handle('open-dashboard', async (_, url: string) => {
  await shell.openExternal(url);
});

ipcMain.handle('get-app-meta', async () => ({
  version: app.getVersion(),
  name: app.getName(),
}));

function mailApiErr(e: unknown): { ok: false; error: string } {
  if (axios.isAxiosError(e)) {
    const detail = e.response?.data as { detail?: unknown } | undefined;
    const msg = detail?.detail;
    const text = Array.isArray(msg)
      ? msg.map((x) => JSON.stringify(x)).join(', ')
      : msg != null
        ? String(msg)
        : e.message;
    return { ok: false as const, error: text };
  }
  return {
    ok: false as const,
    error: e instanceof Error ? e.message : 'Request failed',
  };
}

ipcMain.handle('mail-get-compose-context', async () => {
  const c = readAgentConfig();
  if (!c.accessToken) {
    return { ok: false as const, error: 'Not authenticated' };
  }
  const base = normalizeApiBaseUrl(c.apiBaseUrl).replace(/\/$/, '');
  try {
    const { data } = await axios.get<{
      managers: { name: string; email: string }[];
      assigned_manager_email: string | null;
    }>(`${base}/api/mail/compose-context`, {
      headers: { Authorization: `Bearer ${c.accessToken}` },
    });
    return {
      ok: true as const,
      managers: data.managers,
      assigned_manager_email: data.assigned_manager_email ?? null,
    };
  } catch (e: unknown) {
    return mailApiErr(e);
  }
});

ipcMain.handle(
  'mail-send',
  async (
    _,
    payload: { subject: string; body: string; recipient_email: string }
  ) => {
    const c = readAgentConfig();
    if (!c.accessToken) {
      return { ok: false as const, error: 'Not authenticated' };
    }
    const base = normalizeApiBaseUrl(c.apiBaseUrl).replace(/\/$/, '');
    try {
      const { data } = await axios.post<{ ok: boolean; sent_to: string }>(
        `${base}/api/mail/send-to-manager`,
        {
          subject: payload.subject,
          body: payload.body,
          recipient_email: payload.recipient_email,
        },
        {
          headers: {
            Authorization: `Bearer ${c.accessToken}`,
            'Content-Type': 'application/json',
          },
        }
      );
      return { ok: true as const, sent_to: data.sent_to };
    } catch (e: unknown) {
      return mailApiErr(e);
    }
  }
);

ipcMain.handle('get-team-presence', async () => {
  const c = readAgentConfig();
  if (!c.accessToken) {
    return { ok: false as const, error: 'Not authenticated' };
  }
  const base = normalizeApiBaseUrl(c.apiBaseUrl).replace(/\/$/, '');
  try {
    const { data } = await axios.get<{
      members: {
        user_id: string;
        email: string;
        team: string | null;
        state: 'active' | 'idle' | 'on_break' | 'offline';
        last_seen_at: string | null;
      }[];
    }>(`${base}/api/activity/team-presence`, {
      headers: { Authorization: `Bearer ${c.accessToken}` },
    });
    return {
      ok: true as const,
      members: data.members.map((m) => ({
        ...m,
        last_seen_at: m.last_seen_at ?? null,
      })),
    };
  } catch (e: unknown) {
    return mailApiErr(e);
  }
});
