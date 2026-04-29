/**
 * Node often resolves `localhost` to ::1 first; uvicorn typically listens on 127.0.0.1 only,
 * which yields ECONNREFUSED ::1:8000 from axios in Electron.
 */
export function normalizeApiBaseUrl(raw: string): string {
  const trimmed = raw.trim().replace(/\/+$/, '');
  if (!trimmed) return trimmed;
  try {
    const withProto = /^https?:\/\//i.test(trimmed) ? trimmed : `http://${trimmed}`;
    const u = new URL(withProto);
    if (u.hostname === 'localhost') {
      u.hostname = '127.0.0.1';
    }
    let out = u.toString();
    if (out.endsWith('/')) out = out.slice(0, -1);
    return out;
  } catch {
    return trimmed;
  }
}
