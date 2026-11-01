// Routing for control actions. Every attempt, refused or not, writes exactly one log line.
import { redact } from "../redact";
import type { HermesRead } from "../sources/hermes";
import { STATIONS, type Station } from "../stations";
import type { Snapshot, StationView } from "../snapshot";
import { backupJobs, backupPath, jobsJsonPath, type BackupDeps } from "./backup";
import { checkGuards, createSessionToken } from "./guard";
import { buildArgv, cliAvailable, commandFor, CLI_TIMEOUT_MS, dispatchDetached, HERMES_VERBS, refusalFor, runCli, type HermesVerb, type StationFacts } from "./hermes";
import { IDENTIFIER_RE, reasonRefusal, requeueIssue, TARGET_STATE } from "./linear";
import { ActionLog } from "./log";

export interface ActionsOptions {
  home: string;
  /** Null when no CLI may be used (fixture mode without an override). */
  exe: string | null;
  /** Shown as the planned command in dry run when exe is null. Never executed. */
  plannedExe: string;
  dryRun: boolean;
  linearKey?: string;
  linearUrl?: string;
  /** False when requeue must stay off, whatever the key says. */
  linearAllowed: boolean;
  dataDir: string;
  read: () => { hermes: HermesRead | null; snapshot: Snapshot | null };
  onChanged: (what: "hermes" | "linear") => void;
  token?: string;
  fetchImpl?: typeof fetch;
  cliTimeoutMs?: number;
  backupDeps?: BackupDeps;
  now?: () => number;
}

export interface ControlState { enabled: boolean; reason: string | null }
export type StationControls = Record<HermesVerb, ControlState>;
export interface ActionsStatus {
  hermes: { available: boolean; reason: string | null };
  linear: { available: boolean; reason: string | null };
  dryRun: boolean;
}

const MAX_BODY = 64 * 1024;
const VERB_DONE: Record<Exclude<HermesVerb, "run">, string> = { pause: "Paused", resume: "Resumed" };
export const DISPATCH_MESSAGE = "Dispatched. The run starts on the next scheduler tick and the chip turns WORKING when it does.";

const reply = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" } });

type Parsed =
  | { kind: "station"; id: string; verb: string }
  | { kind: "requeue"; id: string }
  | { kind: "unknown" };

function parsePath(pathname: string): Parsed {
  const dec = (s: string) => {
    try {
      return decodeURIComponent(s);
    } catch {
      return s;
    }
  };
  const st = pathname.match(/^\/api\/actions\/station\/([^/]+)\/([^/]+)$/);
  if (st) return { kind: "station", id: dec(st[1]), verb: dec(st[2]) };
  const iss = pathname.match(/^\/api\/actions\/issue\/([^/]+)\/requeue$/);
  if (iss) return { kind: "requeue", id: dec(iss[1]) };
  return { kind: "unknown" };
}

const attemptName = (p: Parsed) => (p.kind === "station" ? p.verb : p.kind === "requeue" ? "requeue" : "unknown");
const attemptTarget = (p: Parsed, pathname: string) => (p.kind === "unknown" ? pathname : p.id).slice(0, 120);

export function createActions(opts: ActionsOptions) {
  const token = opts.token ?? createSessionToken();
  const log = new ActionLog(opts.dataDir);
  const inFlight = new Set<string>();
  const dispatched = new Map<string, number>();
  const now = opts.now ?? Date.now;

  const hermesAvailable = () => opts.dryRun || cliAvailable(opts.exe);
  const linearAvailable = () => opts.linearAllowed && !!opts.linearKey?.trim();

  function status(): ActionsStatus {
    const h = hermesAvailable();
    const l = linearAvailable();
    return {
      hermes: { available: h, reason: h ? null : "hermes CLI not found" },
      linear: { available: l, reason: l ? null : "Linear not connected" },
      dryRun: opts.dryRun,
    };
  }

  function factsFor(s: Station, hermes: HermesRead | null, view: StationView | undefined): StationFacts {
    return {
      job: hermes?.jobFiles[s.jobsFile]?.jobs[s.jobId] ?? null,
      status: view?.status ?? "UNKNOWN",
      lane: s.lane ? hermes?.lanes?.[s.lane] : undefined,
      consoleDispatchedAt: dispatched.get(s.key) ?? null,
      now: now(),
    };
  }

  /** Adds each station's enabled buttons and reasons, computed by the same rules the POST route enforces. */
  function decorate<T extends Snapshot>(snap: T, hermes: HermesRead | null): T & { actions: ActionsStatus; stations: (StationView & { controls: StationControls })[] } {
    const st = status();
    const stations = snap.stations.map((v) => {
      const s = STATIONS.find((x) => x.key === v.key)!;
      const facts = factsFor(s, hermes, v);
      const controls = Object.fromEntries(HERMES_VERBS.map((verb) => {
        const reason = st.hermes.available ? refusalFor(verb, facts) : st.hermes.reason;
        return [verb, { enabled: !reason, reason }];
      })) as StationControls;
      return { ...v, controls };
    });
    return { ...snap, stations, actions: st };
  }

  async function stationAction(s: Station, verb: HermesVerb, started: number): Promise<Response> {
    const base = { action: verb, target: s.key, profile: s.profile, jobId: s.jobId };
    const done = (result: string, body: any, code: number, extra: { error?: string | null; backup?: string | null; command?: string | null } = {}) => {
      log.append({ ...base, result, durationMs: now() - started, ...extra });
      return reply(body, code);
    };
    if (inFlight.has(s.key)) return done("refused", { ok: false, error: "Another action is in flight for this station" }, 409, { error: "in flight" });
    inFlight.add(s.key);
    try {
      const { hermes, snapshot } = opts.read();
      const refusal = refusalFor(verb, factsFor(s, hermes, snapshot?.stations.find((v) => v.key === s.key)));
      if (refusal) return done("refused", { ok: false, error: refusal }, 409, { error: refusal });

      const argv = buildArgv(s, verb);
      const shown = [opts.exe ?? opts.plannedExe, ...argv].join(" ");
      const source = jobsJsonPath(opts.home, s);

      if (opts.dryRun) {
        const plan = verb === "run" ? null : backupPath(source, verb, new Date(now()));
        return done("dry-run", { ok: true, result: "dry-run", message: `Dry run. Would run: ${shown}`, command: shown, backup: plan }, 200, { command: shown, backup: plan });
      }
      if (!cliAvailable(opts.exe)) return done("refused", { ok: false, error: "hermes CLI not found" }, 409, { error: "hermes CLI not found", command: shown });
      const { file, args } = commandFor(opts.exe!, argv);

      if (verb === "run") {
        const stamp = now();
        const launched = await dispatchDetached(file, args, () => {
          if (dispatched.get(s.key) === stamp) dispatched.delete(s.key);
          opts.onChanged("hermes");
        });
        if (!launched.ok) return done("failed", { ok: false, error: `Could not start hermes (${redact(launched.error)})` }, 502, { error: launched.error, command: shown });
        dispatched.set(s.key, stamp);
        opts.onChanged("hermes");
        return done("dispatched", { ok: true, result: "dispatched", message: DISPATCH_MESSAGE }, 200, { command: shown });
      }

      const backup = await backupJobs(source, verb, opts.backupDeps);
      if (!backup.ok) return done("failed", { ok: false, error: `Backup failed, action aborted: ${backup.error}` }, 500, { error: backup.error, command: shown });

      const cli = await runCli(file, args, opts.cliTimeoutMs ?? CLI_TIMEOUT_MS);
      opts.onChanged("hermes");
      if (!cli.ok) {
        const why = cli.timedOut ? "hermes timed out" : cli.spawnError ? `could not start hermes (${cli.spawnError})` : redact(cli.stderr).trim().slice(0, 500) || `hermes exited with code ${cli.code}`;
        return done("failed", { ok: false, error: why, backup: backup.path }, 502, { error: why, backup: backup.path, command: shown });
      }
      return done("ok", { ok: true, result: "ok", message: `${VERB_DONE[verb]} · backup saved`, backup: backup.path }, 200, { backup: backup.path, command: shown });
    } finally {
      inFlight.delete(s.key);
    }
  }

  async function requeueAction(identifier: string, req: Request, started: number): Promise<Response> {
    let reason: unknown;
    try {
      const text = await req.text();
      if (text.length <= MAX_BODY) reason = JSON.parse(text)?.reason;
    } catch {}
    const reasonText = typeof reason === "string" ? reason.trim() : null;
    const base = { action: "requeue", target: identifier, issue: identifier, reason: reasonText };
    const done = (result: string, body: any, code: number, extra: { error?: string | null; command?: string | null } = {}) => {
      log.append({ ...base, result, durationMs: now() - started, ...extra });
      return reply(body, code);
    };
    const lock = `issue:${identifier.toUpperCase()}`;
    if (inFlight.has(lock)) return done("refused", { ok: false, error: "Another action is in flight for this issue" }, 409, { error: "in flight" });
    const badReason = reasonRefusal(reason);
    if (badReason) return done("refused", { ok: false, error: badReason }, 409, { error: badReason });
    if (!linearAvailable()) return done("refused", { ok: false, error: "Linear not connected" }, 409, { error: "Linear not connected" });

    inFlight.add(lock);
    try {
      const out = await requeueIssue({ apiKey: opts.linearKey!, url: opts.linearUrl, fetchImpl: opts.fetchImpl }, identifier, reasonText!, { dryRun: opts.dryRun });
      switch (out.kind) {
        case "refused":
          return done("refused", { ok: false, error: out.reason }, 409, { error: out.reason });
        case "failed":
          return done("failed", { ok: false, error: out.reason }, 502, { error: out.reason });
        case "planned": {
          const plan = `issueUpdate ${identifier} ${out.from} -> ${TARGET_STATE} (${out.stateId}); commentCreate "${out.comment}"`;
          return done("dry-run", { ok: true, result: "dry-run", message: `Dry run. Would run: ${plan}`, command: plan }, 200, { command: plan });
        }
        case "partial":
          opts.onChanged("linear");
          return done("partial", { ok: true, result: "partial", warning: `Moved to ${TARGET_STATE}, but the comment failed: ${out.reason}` }, 200, { error: out.reason });
        case "moved":
          opts.onChanged("linear");
          return done("ok", { ok: true, result: "ok", message: `Moved to ${TARGET_STATE} · comment added` }, 200);
      }
    } finally {
      inFlight.delete(lock);
    }
  }

  async function handlePost(req: Request, pathname: string): Promise<Response> {
    const started = now();
    const parsed = parsePath(pathname);
    const guard = checkGuards(req.headers, token);
    if (!guard.ok) {
      log.append({ action: attemptName(parsed), target: attemptTarget(parsed, pathname), result: "forbidden", error: guard.reason, durationMs: now() - started });
      return reply({ ok: false, error: "forbidden" }, 403);
    }
    const notFound = (why: string) => {
      log.append({ action: attemptName(parsed), target: attemptTarget(parsed, pathname), result: "not-found", error: why, durationMs: now() - started });
      return reply({ ok: false, error: why }, 404);
    };
    if (parsed.kind === "station") {
      const station = STATIONS.find((s) => s.key === parsed.id);
      if (!station) return notFound("Unknown station");
      if (!(HERMES_VERBS as readonly string[]).includes(parsed.verb)) return notFound("Unknown action");
      return stationAction(station, parsed.verb as HermesVerb, started); // the request body is never read here
    }
    if (parsed.kind === "requeue") {
      if (!IDENTIFIER_RE.test(parsed.id)) return notFound("Unknown issue");
      return requeueAction(parsed.id, req, started);
    }
    return notFound("Unknown action");
  }

  function logResponse(limitParam: string | null): Response {
    const n = Number(limitParam ?? 50);
    const limit = Number.isInteger(n) && n > 0 ? Math.min(n, 200) : 50;
    return reply({ entries: log.recent(limit) });
  }

  return { token, status, decorate, handlePost, logResponse, log };
}
