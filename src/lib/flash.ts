import { randomBytes } from "node:crypto";

/**
 * One-time values handed from a form post to the page it redirects to (e.g. a new test password),
 * so they never travel in a URL. Kept in this server process for 10 minutes and readable once.
 */
// on globalThis: route handlers and pages are separate bundles with their own copy of this module
const g = globalThis as typeof globalThis & { __bdpFlash?: Map<string, { value: string; expires: number }> };
const store = (g.__bdpFlash ??= new Map());

export function putFlash(value: string): string {
  const now = Date.now();
  for (const [k, v] of store) if (v.expires < now) store.delete(k);
  const key = randomBytes(18).toString("base64url");
  store.set(key, { value, expires: now + 10 * 60 * 1000 });
  return key;
}

export function takeFlash(key: string | undefined): string | null {
  if (!key) return null;
  const v = store.get(key);
  store.delete(key);
  return v && v.expires >= Date.now() ? v.value : null;
}
