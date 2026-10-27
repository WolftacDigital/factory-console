// Optional Zeus (Jon-Omen) status: one GET to ZEUS_STATUS_URL with a 3s timeout.
export type ZeusResult =
  | { configured: false }
  | { configured: true; ok: true; state: string; detail: string | null }
  | { configured: true; ok: false; reason: string };

export const ZEUS_TIMEOUT_MS = 3000;
const STATES = ["working", "idle", "paused", "error"];

export async function fetchZeus(url: string | undefined, fetchImpl: typeof fetch = fetch): Promise<ZeusResult> {
  if (!url || !url.trim()) return { configured: false };
  const ctrl = new AbortController();
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    ctrl.abort();
  }, ZEUS_TIMEOUT_MS);
  try {
    const res = await fetchImpl(url.trim(), { signal: ctrl.signal });
    if (!res.ok) return { configured: true, ok: false, reason: `HTTP ${res.status}` };
    const body: any = await res.json();
    if (!body || !STATES.includes(body.state)) return { configured: true, ok: false, reason: "invalid status JSON" };
    return { configured: true, ok: true, state: body.state, detail: typeof body.detail === "string" ? body.detail : null };
  } catch {
    return { configured: true, ok: false, reason: timedOut ? "timeout after 3s" : "unreachable" };
  } finally {
    clearTimeout(timer);
  }
}
