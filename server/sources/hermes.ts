// Read-only Hermes reader. Opens files for reading only; never writes, renames or locks.
import { readFileSync, readdirSync } from "node:fs";
import { basename, join } from "node:path";
import { resolveFixtureTimes } from "../fixtime";

let fixtureTimes = false;
import type { GatewayFields, JobFields, LaneState } from "../status";
import { ROLLBACK_JOB_IDS, STATIONS, parseDefaultJobMap, jobMapMismatches, profileDir } from "../stations";

// Allow-list: the only job fields ever copied out of jobs.json.
export const JOB_FIELDS = [
  "id", "name", "enabled", "state", "paused_at", "paused_reason", "schedule_display", "model", "provider",
  "skills", "last_run_at", "last_status", "last_error", "next_run_at", "failure_streak",
] as const;

type Read<T> = { ok: true; value: T } | { ok: false; reason: string };

function readJson(path: string): Read<any> {
  let raw: string;
  try {
    raw = readFileSync(path, "utf8");
  } catch (e: any) {
    return { ok: false, reason: e?.code === "ENOENT" ? `missing ${path}` : `unreadable ${path} (${e?.code ?? "error"})` };
  }
  try {
    const v = JSON.parse(raw);
    return { ok: true, value: fixtureTimes ? resolveFixtureTimes(v) : v };
  } catch {
    return { ok: false, reason: `invalid JSON in ${path}` };
  }
}

export function pickJob(raw: any): JobFields {
  if (!isRecord(raw) || typeof raw.id !== "string") throw new Error("invalid job object");
  const out: any = {};
  for (const f of JOB_FIELDS) {
    if (!Object.hasOwn(raw, f)) continue;
    const v = raw[f];
    const valid = f === "enabled" ? typeof v === "boolean"
      : f === "failure_streak" ? v === null || (typeof v === "number" && Number.isInteger(v) && v >= 0)
      : f === "skills" ? v === null || (Array.isArray(v) && v.every((s) => typeof s === "string"))
      : f === "last_run_at" || f === "next_run_at" || f === "paused_at" ? isTimestamp(v)
      : v === null || typeof v === "string";
    // Report the schema field, never the rejected value (it may contain private data).
    if (!valid) throw new Error(`invalid job field: ${f}`);
    out[f] = v;
  }
  return out as JobFields;
}

function isRecord(v: unknown): v is Record<string, any> {
  return v !== null && typeof v === "object" && !Array.isArray(v);
}

function isTimestamp(v: unknown): boolean {
  return v === null || (typeof v === "string" && /^\d{4}-\d{2}-\d{2}T/.test(v) && Number.isFinite(Date.parse(v)));
}

export interface JobsFile { jobs: Record<string, JobFields>; error?: string }

function readJobs(home: string, rel: string): JobsFile {
  const r = readJson(join(home, rel));
  if (!r.ok) return { jobs: {}, error: r.reason.replace(home, "HERMES_HOME") };
  const list = Array.isArray(r.value?.jobs) ? r.value.jobs : null;
  if (!list) return { jobs: {}, error: `no jobs[] in ${rel}` };
  const jobs: Record<string, JobFields> = Object.create(null);
  try {
    for (const j of list) {
      const job = pickJob(j);
      jobs[job.id] = job;
    }
  } catch {
    return { jobs: {}, error: `invalid job fields in ${rel}` };
  }
  return { jobs };
}

/** Newest file (by name, then mtime) in a directory, or null. */
function newestFile(dir: string, filter: (n: string) => boolean): string | null {
  let names: string[];
  try {
    names = readdirSync(dir).filter(filter);
  } catch {
    return null;
  }
  if (!names.length) return null;
  names.sort();
  return join(dir, names[names.length - 1]);
}

/** Up to `max` lines of the run's response. The prompt section is never returned. */
export function outputExcerpt(text: string, max = 60): string[] {
  const lines = text.replace(/\r\n/g, "\n").split("\n");
  const resp = lines.findIndex((l) => /^##\s+Response\b/.test(l));
  let body: string[];
  if (resp >= 0) body = lines.slice(resp + 1);
  else {
    const prompt = lines.findIndex((l) => /^##\s+Prompt\b/.test(l));
    body = prompt >= 0 ? lines.slice(0, prompt) : lines;
  }
  while (body.length && !body[0].trim()) body.shift();
  while (body.length && !body[body.length - 1].trim()) body.pop();
  return body.slice(-max);
}

export interface RunOutput { file: string; lines: string[] }

function latestOutput(home: string, profile: string, jobId: string): RunOutput | null {
  const dir = join(home, profileDir(profile), "cron", "output", jobId);
  const f = newestFile(dir, (n) => /^\d{4}-\d{2}-\d{2}_\d{2}-\d{2}-\d{2}\.md$/.test(n));
  if (!f) return null;
  try {
    return { file: basename(f), lines: outputExcerpt(readFileSync(f, "utf8")) };
  } catch {
    return null;
  }
}

export interface HermesRead {
  home: string;
  jobFiles: Record<string, JobsFile>;
  lanes: Record<string, LaneState> | null;
  lanesError?: string;
  gateway: (GatewayFields & { platforms: { name: string; state: string }[] }) | null;
  gatewayError?: string;
  outputs: Record<string, RunOutput | null>;
  gatekeeperLogs: Record<string, RunOutput | null>;
  jobMapMismatch: string[];
  jobMapError?: string;
  rollbackJobs: { id: string; name: string; state: string; pausedAt: string | null }[];
}

export function readHermes(home: string, opts: { fixtures?: boolean } = {}): HermesRead {
  fixtureTimes = !!opts.fixtures;
  const files = new Set(STATIONS.map((s) => s.jobsFile));
  const jobFiles: Record<string, JobsFile> = {};
  for (const f of files) jobFiles[f] = readJobs(home, f);

  const gk = readJson(join(home, "cron", "gatekeeper-state.json"));
  let lanes: Record<string, LaneState> | null = null;
  let lanesError: string | undefined;
  if (gk.ok && isRecord(gk.value?.lanes)) {
    lanes = Object.create(null);
    for (const k of ["build", "review", "integrate"]) {
      const v = gk.value.lanes[k];
      if (v === undefined) continue;
      if (!isRecord(v) || !isTimestamp(v.dispatched_at ?? null) || !isTimestamp(v.job_last_run_at ?? null)) {
        lanes = null;
        lanesError = "invalid lane fields in gatekeeper-state.json";
        break;
      }
      lanes![k] = { dispatched_at: v.dispatched_at ?? null, job_last_run_at: v.job_last_run_at ?? null };
    }
  } else lanesError = gk.ok ? "gatekeeper-state.json has no lanes" : gk.reason.replace(home, "HERMES_HOME");

  const gw = readJson(join(home, "gateway_state.json"));
  let gateway: HermesRead["gateway"] = null;
  let gatewayError: string | undefined;
  if (gw.ok && isRecord(gw.value)) {
    const v = gw.value;
    const ps = v.platforms ?? {};
    if ((v.gateway_state !== undefined && typeof v.gateway_state !== "string") ||
        (v.active_agents !== undefined && (typeof v.active_agents !== "number" || !Number.isInteger(v.active_agents) || v.active_agents < 0)) ||
        !isRecord(ps) || Object.values(ps).some((p) => !isRecord(p) || (p.state !== undefined && typeof p.state !== "string"))) {
      gatewayError = "invalid fields in gateway_state.json";
    } else {
      const platforms = Object.entries(ps).map(([name, p]) => ({ name, state: p.state ?? "unknown" }));
      gateway = { gateway_state: v.gateway_state, active_agents: v.active_agents ?? 0, platforms };
    }
  } else gatewayError = gw.ok ? "gateway_state.json is not an object" : gw.reason.replace(home, "HERMES_HOME");

  const outputs: Record<string, RunOutput | null> = {};
  for (const s of STATIONS) outputs[s.key] = latestOutput(home, s.profile, s.jobId);

  const gatekeeperLogs: Record<string, RunOutput | null> = {};
  for (const lane of ["build", "review", "integrate"]) {
    const f = newestFile(join(home, "cron", "gatekeeper-logs"), (n) => n.startsWith(`${lane}-`) && n.endsWith(".log"));
    let out: RunOutput | null = null;
    if (f) {
      try {
        out = { file: basename(f), lines: readFileSync(f, "utf8").replace(/\r\n/g, "\n").trimEnd().split("\n").slice(-20) };
      } catch {}
    }
    gatekeeperLogs[lane] = out;
  }

  let jobMapMismatch: string[] = [];
  let jobMapError: string | undefined;
  try {
    const src = readFileSync(join(home, "scripts", "factory_gatekeeper.py"), "utf8");
    const map = parseDefaultJobMap(src);
    if (!map) jobMapError = "DEFAULT_JOB_MAP not found in factory_gatekeeper.py";
    else jobMapMismatch = jobMapMismatches(map);
  } catch {
    jobMapError = "factory_gatekeeper.py unreadable";
  }

  const def = jobFiles["cron/jobs.json"];
  const rollbackJobs = ROLLBACK_JOB_IDS.filter((id) => def?.jobs[id]).map((id) => {
    const j = def.jobs[id];
    return { id, name: j.name ?? id, state: j.enabled === false || j.state === "paused" ? "paused" : String(j.state ?? "unknown"), pausedAt: j.paused_at ?? null };
  });

  return { home, jobFiles, lanes, lanesError, gateway, gatewayError, outputs, gatekeeperLogs, jobMapMismatch, jobMapError, rollbackJobs };
}
