// Builds the redacted, allow-listed snapshot sent to the browser. Every field is constructed explicitly.
import { redact, redactOrNull } from "./redact";
import { CRM_PROJECT, STATIONS } from "./stations";
import { crmJobStatus, createdLast24h, currentIssue, gatekeeperStatus, laneJobStatus, loganStatus, zeusStatus, type IssueLite, type Status, type StatusResult } from "./status";
import type { HermesRead } from "./sources/hermes";
import { boardColumns, BOARD_COLUMNS, type LinearResult } from "./sources/linear";
import type { ZeusResult } from "./sources/zeus";

export interface SourceState { state: "connected" | "disconnected" | "degraded" | "unconfigured"; reason: string | null }
export interface IssueRef { identifier: string; title: string; url: string }
export interface Card extends IssueRef { lane: string; assignee: string | null; delegate: string | null; project: string | null }

export interface StationView {
  key: string; name: string; role: string; profile: string; jobId: string;
  model: string | null; provider: string | null; schedule: string | null; skills: string[];
  status: Status; reason: string;
  currentIssue: IssueRef | null; currentNote: string | null;
  detail: {
    lastRunAt: string | null; lastStatus: string | null; nextRunAt: string | null; failureStreak: number | null;
    lastError: string | null; pausedReason: string | null; pausedAt: string | null;
    outputFile: string | null; outputExcerpt: string[];
    gatekeeperLogs?: { lane: string; file: string; lines: string[] }[];
  };
}

export interface Snapshot {
  mode: "live" | "fixtures";
  sources: { hermes: SourceState; linear: SourceState; zeus: SourceState };
  warnings: string[];
  owner: { name: string; role: string };
  logan: {
    name: string; role: string; status: Status; reason: string; gatewayState: string | null; activeAgents: number | null;
    platforms: { name: string; state: string }[];
    rollbackJobs: { id: string; name: string; state: string; pausedAt: string | null }[];
  };
  zeus: { name: string; role: string; status: Status; label: string; detail: string | null };
  spec: { name: string; role: string; status: Status; createdLast24h: number | null };
  stations: StationView[];
  board: { columns: { name: string; label: string; cards: Card[] }[] } | null;
}

export function laneTag(i: IssueLite): string {
  if (i.project === CRM_PROJECT) return "crm";
  const lane = i.labels.find((l) => l.toLowerCase() !== "factory queue");
  return lane ? lane.toLowerCase() : "none";
}

export function safeUrl(u: string): string {
  return /^https:\/\/linear\.app\//.test(u) ? u : "";
}

const ref = (i: IssueLite): IssueRef => ({ identifier: redact(i.identifier), title: redact(i.title), url: safeUrl(i.url) });
const uniq = <T,>(xs: T[]) => xs.filter((v, i, a) => a.indexOf(v) === i);

export function buildSnapshot(
  h: HermesRead | null,
  hermesError: string | null,
  linear: LinearResult | null,
  zeus: ZeusResult,
  now: number,
  mode: "live" | "fixtures",
): Snapshot {
  const issues = linear && linear.ok ? linear.issues : null;
  const warnings: string[] = [];
  if (h) {
    for (const lane of h.jobMapMismatch) warnings.push(`job map mismatch: ${lane}`);
    if (h.jobMapError) warnings.push(`job map check unavailable: ${h.jobMapError}`);
  }

  const stations: StationView[] = STATIONS.map((s) => {
    const file = h?.jobFiles[s.jobsFile];
    const job = file?.jobs[s.jobId];
    const missing = !h
      ? hermesError ?? "Hermes home unreadable"
      : file?.error ?? `job ${s.jobId} not found in ${s.jobsFile}`;
    let st: StatusResult;
    if (!job) st = { status: "UNKNOWN", reason: missing };
    else if (s.kind === "gatekeeper") st = gatekeeperStatus(job, now);
    else if (s.kind === "crm") st = crmJobStatus(job, issues, now, CRM_PROJECT);
    else st = laneJobStatus(job, h?.lanes?.[s.lane!], now, h?.lanes ? undefined : `gatekeeper-state unavailable: ${h?.lanesError ?? "unknown"}`);

    let cur: IssueLite | null = null;
    let note: string | null = null;
    if (st.status === "WORKING" && s.kind !== "gatekeeper") {
      cur = currentIssue(s.key, issues, CRM_PROJECT);
      if (!cur) note = issues ? "picking up work" : "picking up work (Linear not connected)";
    }
    const out = h?.outputs[s.key] ?? null;
    const view: StationView = {
      key: s.key, name: s.name, role: s.role, profile: s.profile, jobId: s.jobId,
      model: redactOrNull(job?.model), provider: redactOrNull(job?.provider), schedule: redactOrNull(job?.schedule_display),
      skills: Array.isArray(job?.skills) ? job!.skills!.map((x) => redact(x)) : [],
      status: st.status, reason: redact(st.reason),
      currentIssue: cur ? ref(cur) : null, currentNote: note,
      detail: {
        lastRunAt: job?.last_run_at ?? null,
        lastStatus: redactOrNull(job?.last_status),
        nextRunAt: job?.next_run_at ?? null,
        failureStreak: typeof job?.failure_streak === "number" ? job.failure_streak : null,
        lastError: redactOrNull(job?.last_error),
        pausedReason: redactOrNull(job?.paused_reason),
        pausedAt: job?.paused_at ?? null,
        outputFile: out?.file ?? null,
        outputExcerpt: (out?.lines ?? []).map((l) => redact(l)),
      },
    };
    if (s.kind === "gatekeeper" && h) {
      view.detail.gatekeeperLogs = Object.entries(h.gatekeeperLogs)
        .filter(([, v]) => v)
        .map(([lane, v]) => ({ lane, file: v!.file, lines: v!.lines.map((l) => redact(l)) }));
    }
    return view;
  });

  const lg = loganStatus(h?.gateway ?? undefined, h ? h.gatewayError : hermesError ?? undefined);
  const zs: StatusResult = !zeus.configured
    ? { status: "UNKNOWN", reason: "Remote · status unknown" }
    : zeus.ok
      ? zeusStatus(zeus.state, zeus.detail ?? "reported by ZEUS_STATUS_URL")
      : zeusStatus(null, `Remote · ${zeus.reason}`);

  let hermesSource: SourceState;
  if (!h) hermesSource = { state: "disconnected", reason: redact(hermesError ?? "unreadable") };
  else {
    const problems = uniq([h.lanesError, h.gatewayError, ...STATIONS.map((s) => h.jobFiles[s.jobsFile]?.error)].filter(Boolean) as string[]);
    const unknown = stations.some((s) => s.status === "UNKNOWN");
    hermesSource = problems.length || unknown
      ? { state: "degraded", reason: redact(problems.join("; ") || "some stations unknown") }
      : { state: "connected", reason: null };
  }

  return {
    mode,
    sources: {
      hermes: hermesSource,
      linear: linear === null
        ? { state: "disconnected", reason: "not fetched yet" }
        : linear.ok ? { state: "connected", reason: null } : { state: "disconnected", reason: redact(linear.reason) },
      zeus: !zeus.configured
        ? { state: "unconfigured", reason: "ZEUS_STATUS_URL not set" }
        : zeus.ok ? { state: "connected", reason: null } : { state: "disconnected", reason: redact(zeus.reason) },
    },
    warnings,
    owner: { name: "Jonathan", role: "Owner" },
    logan: {
      name: "Logan", role: "Hermes · this PC", status: lg.status, reason: redact(lg.reason),
      gatewayState: h?.gateway?.gateway_state ? redact(h.gateway.gateway_state) : null,
      activeAgents: h?.gateway ? h.gateway.active_agents ?? 0 : null,
      platforms: (h?.gateway?.platforms ?? []).map((p) => ({ name: redact(p.name), state: redact(p.state) })),
      rollbackJobs: (h?.rollbackJobs ?? []).map((r) => ({ id: r.id, name: redact(r.name), state: r.state, pausedAt: r.pausedAt })),
    },
    zeus: {
      name: "Zeus", role: "Jon-Omen · remote", status: zs.status, label: redact(zs.reason),
      detail: zeus.configured && zeus.ok && zeus.detail ? redact(zeus.detail) : null,
    },
    spec: { name: "Spec", role: "Interactive sessions", status: "ON DEMAND", createdLast24h: createdLast24h(issues, now) },
    stations,
    board: issues
      ? {
          columns: (() => {
            const cols = boardColumns(issues, now);
            return BOARD_COLUMNS.map((c) => ({
              name: c,
              label: c === "Done" ? "Done (7d)" : c,
              cards: cols[c].map((i) => ({
                ...ref(i), lane: redact(laneTag(i)),
                assignee: redactOrNull(i.assignee), delegate: redactOrNull(i.delegate), project: redactOrNull(i.project),
              })),
            }));
          })(),
        }
      : null,
  };
}
