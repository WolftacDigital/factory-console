// Pure status rules. No I/O here; every function is unit-tested in test/status.test.ts.
export type Status = "WORKING" | "IDLE" | "PAUSED" | "ERROR" | "UNKNOWN" | "ON DEMAND";

export interface JobFields {
  id: string;
  name?: string;
  enabled?: boolean;
  state?: string;
  paused_at?: string | null;
  paused_reason?: string | null;
  schedule_display?: string | null;
  model?: string | null;
  provider?: string | null;
  skills?: string[] | null;
  last_run_at?: string | null;
  last_status?: string | null;
  last_error?: unknown;
  next_run_at?: string | null;
  failure_streak?: number | null;
}

export interface LaneState { dispatched_at?: string | null; job_last_run_at?: string | null }

export interface IssueLite {
  identifier: string;
  title: string;
  url: string;
  state: string;
  labels: string[];
  project: string | null;
  assignee: string | null;
  delegate: string | null;
  createdAt: string;
  updatedAt: string;
  completedAt?: string | null;
}

export interface StatusResult { status: Status; reason: string }

export const WORKING_WINDOW_MS = 90 * 60 * 1000;
/** Gatekeeper (no lane): treated as running when its run is due within this grace window. */
export const GATEKEEPER_FIRING_GRACE_MS = 5 * 60 * 1000;

const t = (s: string | null | undefined): number => (s ? Date.parse(s) : NaN);

function pausedOrError(job: JobFields): StatusResult | null {
  if (job.enabled === false || job.state === "paused") {
    return { status: "PAUSED", reason: job.paused_reason ? "paused" : "job disabled or paused" };
  }
  return null;
}

function errorOrIdle(job: JobFields): StatusResult {
  if (job.last_status !== "ok" || (job.failure_streak ?? 0) > 0) {
    return { status: "ERROR", reason: `last_status=${job.last_status ?? "none"}, failure_streak=${job.failure_streak ?? 0}` };
  }
  return { status: "IDLE", reason: "last run ok" };
}

/** Lane-driven worker (build agentic / review / integrate). */
export function laneJobStatus(job: JobFields | undefined, lane: LaneState | undefined, now: number, missingReason?: string): StatusResult {
  if (!job) return { status: "UNKNOWN", reason: missingReason ?? "job not found in jobs.json" };
  const p = pausedOrError(job);
  if (p) return p;
  if (missingReason) return { status: "UNKNOWN", reason: missingReason };
  const d = t(lane?.dispatched_at);
  const last = t(job.last_run_at);
  if (!Number.isNaN(d) && (Number.isNaN(last) || d > last) && now - d < WORKING_WINDOW_MS) {
    return { status: "WORKING", reason: "gatekeeper dispatched after the last run" };
  }
  return errorOrIdle(job);
}

/** Build · crm: no gatekeeper lane; driven by Linear In Progress activity in the CRM project. */
export function crmJobStatus(job: JobFields | undefined, issues: IssueLite[] | null, now: number, crmProject: string, missingReason?: string): StatusResult {
  if (!job) return { status: "UNKNOWN", reason: missingReason ?? "job not found in jobs.json" };
  const p = pausedOrError(job);
  if (p) return p;
  const last = t(job.last_run_at);
  if (issues) {
    const hit = issues.find((i) => {
      if (i.state !== "In Progress" || i.project !== crmProject) return false;
      const u = t(i.updatedAt);
      return (Number.isNaN(last) || u > last) && now - u < WORKING_WINDOW_MS;
    });
    if (hit) return { status: "WORKING", reason: `${hit.identifier} updated after the last run` };
  }
  return errorOrIdle(job);
}

/** Gatekeeper script job: from its own job fields only. WORKING while its due run is firing. */
export function gatekeeperStatus(job: JobFields | undefined, now: number, missingReason?: string): StatusResult {
  if (!job) return { status: "UNKNOWN", reason: missingReason ?? "job not found in jobs.json" };
  const p = pausedOrError(job);
  if (p) return p;
  const next = t(job.next_run_at);
  if (!Number.isNaN(next) && now >= next && now - next < GATEKEEPER_FIRING_GRACE_MS) {
    return { status: "WORKING", reason: "scheduled run is due / firing" };
  }
  return errorOrIdle(job);
}

export interface GatewayFields { gateway_state?: string; active_agents?: number }

export function loganStatus(gw: GatewayFields | undefined, missingReason?: string): StatusResult {
  if (!gw) return { status: "UNKNOWN", reason: missingReason ?? "gateway_state.json missing" };
  if ((gw.active_agents ?? 0) > 0) return { status: "WORKING", reason: `${gw.active_agents} active agent(s)` };
  if (gw.gateway_state === "running") return { status: "IDLE", reason: "gateway running" };
  return { status: "ERROR", reason: `gateway_state=${gw.gateway_state ?? "none"}` };
}

export function zeusStatus(state: string | null | undefined, reason: string): StatusResult {
  const map: Record<string, Status> = { working: "WORKING", idle: "IDLE", paused: "PAUSED", error: "ERROR" };
  const s = state ? map[state] : undefined;
  return s ? { status: s, reason } : { status: "UNKNOWN", reason };
}

const oldest = (xs: IssueLite[]) => [...xs].sort((a, b) => t(a.createdAt) - t(b.createdAt))[0] ?? null;

/** Current issue for a WORKING station; null means "picking up work". */
export function currentIssue(stationKey: string, issues: IssueLite[] | null, crmProject: string): IssueLite | null {
  if (!issues) return null;
  switch (stationKey) {
    case "build-agentic":
      return oldest(issues.filter((i) => i.state === "In Progress" && i.labels.some((l) => l.toLowerCase() === "agentic")));
    case "build-crm":
      return oldest(issues.filter((i) => i.state === "In Progress" && i.project === crmProject));
    case "review":
      return oldest(issues.filter((i) => i.state === "In Review"));
    case "integrate":
      return oldest(issues.filter((i) => i.state === "Approved"));
    default:
      return null;
  }
}

export function createdLast24h(issues: IssueLite[] | null, now: number): number | null {
  if (!issues) return null;
  return issues.filter((i) => now - t(i.createdAt) < 24 * 3600 * 1000).length;
}
