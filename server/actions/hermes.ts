// The only place the hermes CLI is called. Verbs come from HERMES_VERBS; profile and job id from the station table.
import { dlopen } from "bun:ffi";
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { join, resolve } from "node:path";
import type { JobFields, LaneState, Status } from "../status";
import { WORKING_WINDOW_MS } from "../status";
import type { Station } from "../stations";

export const HERMES_VERBS = ["pause", "resume", "run"] as const;
export type HermesVerb = (typeof HERMES_VERBS)[number];
export const CLI_TIMEOUT_MS = 30_000;

/** hermes.exe [-p <profile>] cron pause|resume|run <jobId>. No -p for the default profile. */
export function buildArgv(station: Pick<Station, "profile" | "jobId">, verb: HermesVerb): string[] {
  if (!HERMES_VERBS.includes(verb)) throw new Error("verb not allowed");
  return [...(station.profile === "default" ? [] : ["-p", station.profile]), "cron", verb, station.jobId];
}

export function defaultHermesExe(env: Record<string, string | undefined> = process.env): string {
  return join(env.LOCALAPPDATA ?? "", "hermes", "hermes-agent", "venv", "Scripts", "hermes.exe");
}

/**
 * HERMES_EXE override, otherwise the installed CLI. Fixture mode never falls back to the installed CLI,
 * so a fixture server started without an override cannot reach the real factory.
 */
export function resolveHermesExe(env: Record<string, string | undefined>, fixtures: boolean): string | null {
  const override = env.HERMES_EXE?.trim();
  if (override) return resolve(override);
  return fixtures ? null : defaultHermesExe(env);
}

/** A .ts/.js HERMES_EXE (the fake CLI in tests) runs under the current Bun. Always an argv array, never a shell string. */
export function commandFor(exe: string, argv: string[]): { file: string; args: string[] } {
  return /\.(ts|js)$/i.test(exe) ? { file: process.execPath, args: [exe, ...argv] } : { file: exe, args: argv };
}

export const cliAvailable = (exe: string | null): boolean => !!exe && existsSync(exe);

/** The worker gets the console's environment minus the console's own Linear key. */
function childEnv(): Record<string, string | undefined> {
  const env: Record<string, string | undefined> = { ...process.env };
  delete env.LINEAR_API_KEY;
  return env;
}

/**
 * Windows children inherit every inheritable handle, and Bun's sockets are inheritable. A worker that runs for hours
 * would otherwise keep this server's listening socket alive, and the console could not restart on its port until
 * the run ended. This clears the flag on all of this process's handles just before a spawn.
 */
function dropHandleInheritance() {
  if (process.platform !== "win32") return;
  try {
    const { symbols } = dlopen("kernel32.dll", { SetHandleInformation: { args: ["u64", "u32", "u32"], returns: "i32" } });
    const HANDLE_FLAG_INHERIT = 1;
    for (let h = 4; h < 0x40000; h += 4) symbols.SetHandleInformation(h, HANDLE_FLAG_INHERIT, 0);
  } catch {}
}

export interface CliResult { ok: boolean; code: number | null; stderr: string; timedOut: boolean; spawnError?: string }

/** Pause and resume: wait for exit, up to the timeout. */
export function runCli(file: string, args: string[], timeoutMs = CLI_TIMEOUT_MS): Promise<CliResult> {
  return new Promise((done) => {
    let stderr = "";
    let timedOut = false;
    dropHandleInheritance();
    const child = spawn(file, args, { shell: false, windowsHide: true, stdio: ["ignore", "ignore", "pipe"], env: childEnv() as NodeJS.ProcessEnv });
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill();
    }, timeoutMs);
    child.stderr?.on("data", (d) => {
      if (stderr.length < 8192) stderr += String(d);
    });
    child.once("error", (e: any) => {
      clearTimeout(timer);
      done({ ok: false, code: null, stderr, timedOut, spawnError: e?.code ?? "spawn failed" });
    });
    child.once("close", (code) => {
      clearTimeout(timer);
      done({ ok: code === 0 && !timedOut, code, stderr, timedOut });
    });
  });
}

/**
 * Run now: `cron run` blocks for the whole worker run, so it is launched detached and never awaited or killed.
 * Resolves as soon as the process has started. onFail fires only on a non-zero exit, so the
 * double-fire hold can be released when the launch did not take.
 */
export function dispatchDetached(file: string, args: string[], onFail: () => void = () => {}): Promise<{ ok: true } | { ok: false; error: string }> {
  return new Promise((done) => {
    dropHandleInheritance();
    const child = spawn(file, args, { detached: true, stdio: "ignore", shell: false, windowsHide: true, env: childEnv() as NodeJS.ProcessEnv });
    child.once("error", (e: any) => done({ ok: false, error: e?.code ?? "spawn failed" }));
    child.once("spawn", () => {
      child.unref();
      done({ ok: true });
    });
    child.once("exit", (code) => {
      if (code) onFail();
    });
  });
}

export const isPaused = (job: JobFields): boolean => job.enabled === false || job.state === "paused";

const ms = (s: string | null | undefined) => (s ? Date.parse(s) : NaN);

/** The gatekeeper dispatched this lane after the job's last run, less than 90 minutes ago. */
export function laneInFlight(lane: LaneState | undefined, job: JobFields, now: number): boolean {
  const d = ms(lane?.dispatched_at);
  const last = ms(job.last_run_at);
  return !Number.isNaN(d) && (Number.isNaN(last) || d > last) && now - d < WORKING_WINDOW_MS;
}

export interface StationFacts {
  job: JobFields | null | undefined;
  status: Status;
  lane?: LaneState;
  /** When this console last dispatched Run now and is still waiting for the run to show up. */
  consoleDispatchedAt?: number | null;
  now: number;
}

export const REFUSE_ALREADY_RUNNING = "Already running or dispatched";

/** Why an action is refused right now, or null when it is valid. Shared by the buttons and the POST route. */
export function refusalFor(verb: HermesVerb, f: StationFacts): string | null {
  if (!f.job) return "Job not found";
  if (verb === "pause") return isPaused(f.job) ? "Already paused" : null;
  if (verb === "resume") return isPaused(f.job) ? null : "Not paused";
  if (isPaused(f.job)) return "Resume first";
  if (f.status === "WORKING" || laneInFlight(f.lane, f.job, f.now)) return REFUSE_ALREADY_RUNNING;
  if (f.status === "UNKNOWN") return "Status unknown";
  if (f.consoleDispatchedAt && f.now - f.consoleDispatchedAt < WORKING_WINDOW_MS) {
    const last = ms(f.job.last_run_at);
    if (Number.isNaN(last) || last <= f.consoleDispatchedAt) return REFUSE_ALREADY_RUNNING;
  }
  return null;
}
