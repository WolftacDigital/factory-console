// Browser side of the control actions: token handling, POST helper, dialog wording, announcements.
import type { ActionLogEntry, ActionVerb, StationView } from "./types";

export interface ActionResponse {
  ok: boolean;
  result?: string;
  message?: string;
  warning?: string;
  error?: string;
  backup?: string | null;
}

let token: string | null = null;

async function fetchToken(): Promise<string> {
  const res = await fetch("/api/session");
  const body = await res.json();
  token = String(body.token);
  return token;
}

function send(path: string, body: unknown, t: string) {
  return fetch(path, { method: "POST", headers: { "Content-Type": "application/json", "X-Console-Token": t }, body: JSON.stringify(body) });
}

/** POST with the session token. The token changes when the server restarts, so a 403 re-reads it once. */
export async function postAction(path: string, body: unknown = {}): Promise<ActionResponse> {
  try {
    const first = token ?? (await fetchToken());
    let res = await send(path, body, first);
    if (res.status === 403) {
      const fresh = await fetchToken();
      if (fresh !== first) res = await send(path, body, fresh);
    }
    const parsed = (await res.json()) as ActionResponse;
    return parsed;
  } catch {
    return { ok: false, error: "Could not reach the console server" };
  } finally {
    notifyLogChanged();
  }
}

export async function fetchActionLog(limit = 50): Promise<ActionLogEntry[]> {
  const res = await fetch(`/api/actions/log?limit=${limit}`);
  const body = await res.json();
  return Array.isArray(body.entries) ? body.entries : [];
}

const logListeners = new Set<() => void>();
export function onLogChanged(fn: () => void) {
  logListeners.add(fn);
  return () => {
    logListeners.delete(fn);
  };
}
function notifyLogChanged() {
  for (const fn of logListeners) fn();
}

const announceListeners = new Set<(msg: string) => void>();
export function onAnnounce(fn: (msg: string) => void) {
  announceListeners.add(fn);
  return () => {
    announceListeners.delete(fn);
  };
}
/** Sends a result to the app's polite aria-live region. */
export function announce(msg: string) {
  for (const fn of announceListeners) fn(msg);
}

export const VERB_LABEL: Record<ActionVerb, string> = { pause: "Pause", resume: "Resume", run: "Run now" };

const REQUEUE_COLUMNS = ["In Progress", "In Review", "Approved"];
export const canRequeue = (columnName: string) => REQUEUE_COLUMNS.includes(columnName);
export const MIN_REASON = 10;

function effect(verb: ActionVerb, key: string): string {
  if (verb === "run") return "Starts one run outside the normal schedule. The console does not wait for it to finish.";
  if (key === "gatekeeper") return verb === "pause" ? "No lane will be dispatched until resumed." : "The gatekeeper returns to dispatching lanes on its schedule.";
  if (key === "build-crm") return verb === "pause" ? "This job will stop running on its schedule until resumed." : "This job returns to its normal schedule.";
  return verb === "pause" ? "The gatekeeper will stop dispatching this lane until resumed." : "The gatekeeper can dispatch this lane again.";
}

/** The exact confirmation wording: station, profile, job id and effect. */
export function confirmText(s: Pick<StationView, "key" | "name" | "profile" | "jobId">, verb: ActionVerb): { title: string; body: string } {
  return { title: `${VERB_LABEL[verb]} ${s.name}`, body: `${VERB_LABEL[verb]} ${s.name} · ${s.profile} · ${s.jobId}. ${effect(verb, s.key)}` };
}
