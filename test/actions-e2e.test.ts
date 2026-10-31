// Starts the real server against a temp copy of fixtures/mixed, the fake CLI and a local mock Linear.
// HERMES_EXE, FACTORY_FIXTURES and LINEAR_API_URL are always set here, so nothing can reach the real factory.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { execFileSync } from "node:child_process";
import { cpSync, existsSync, mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createMockLinear } from "../fixtures/mock-linear/mock";

const ROOT = join(import.meta.dir, "..");
const ORIGIN = "http://127.0.0.1:8095";
const sha = (p: string) => createHash("sha256").update(readFileSync(p)).digest("hex");

interface Rig {
  home: string; argvFile: string; dataDir: string; base: string; token: string;
  proc: ReturnType<typeof Bun.spawn>; mock: ReturnType<typeof createMockLinear>; mockServer: ReturnType<typeof Bun.serve>;
  dir: string;
}

async function startRig(port: number, mockPort: number, env: Record<string, string> = {}): Promise<Rig> {
  const dir = mkdtempSync(join(tmpdir(), "wd555-e2e-"));
  const home = join(dir, "home");
  cpSync(join(ROOT, "fixtures", "mixed"), home, { recursive: true });
  const argvFile = join(dir, "argv.jsonl");
  const dataDir = join(dir, "data");
  const mock = createMockLinear({ fixture: join(home, "linear.json") });
  const mockServer = Bun.serve({ hostname: "127.0.0.1", port: mockPort, fetch: mock.fetch });
  const proc = Bun.spawn([process.execPath, "--no-env-file", join(ROOT, "server", "index.ts")], {
    cwd: dir,
    env: {
      PATH: process.env.PATH ?? "",
      SystemRoot: process.env.SystemRoot ?? "",
      TEMP: process.env.TEMP ?? "",
      TMP: process.env.TMP ?? "",
      PORT: String(port),
      FACTORY_FIXTURES: home,
      FACTORY_DATA_DIR: dataDir,
      HERMES_EXE: join(ROOT, "fixtures", "fake-hermes", "fake-hermes.ts"),
      FAKE_HERMES_ARGV_FILE: argvFile,
      FAKE_HERMES_HOME: home,
      LINEAR_API_URL: `http://127.0.0.1:${mockPort}/graphql`,
      LINEAR_API_KEY: "fake-test-key",
      ...env,
    },
    stdout: "ignore",
    stderr: "ignore",
  });
  const base = `http://127.0.0.1:${port}`;
  for (let i = 0; i < 100; i++) {
    try {
      if ((await fetch(`${base}/api/health`)).ok) break;
    } catch {}
    await Bun.sleep(100);
  }
  const token = (await (await fetch(`${base}/api/session`)).json()).token;
  return { home, argvFile, dataDir, base, token, proc, mock, mockServer, dir };
}

async function stopRig(r: Rig) {
  r.proc.kill();
  await r.proc.exited;
  r.mockServer.stop(true);
  try {
    rmSync(r.dir, { recursive: true, force: true, maxRetries: 3 });
  } catch {} // a detached fake `run` may still hold nothing but its own process; temp cleanup is best effort
}

const post = (r: Rig, path: string, body: unknown = {}, headers: Record<string, string> = {}) =>
  fetch(r.base + path, { method: "POST", headers: { Origin: ORIGIN, "X-Console-Token": r.token, "Content-Type": "application/json", ...headers }, body: JSON.stringify(body) });
const argvLines = (r: Rig): string[][] => (existsSync(r.argvFile) ? readFileSync(r.argvFile, "utf8").trim().split("\n").filter(Boolean).map((l) => JSON.parse(l).argv) : []);
const logLines = (r: Rig): any[] => {
  const f = join(r.dataDir, "actions.jsonl");
  return existsSync(f) ? readFileSync(f, "utf8").trim().split("\n").filter(Boolean).map((l) => JSON.parse(l)) : [];
};
const backups = (dir: string, verb: string) => readdirSync(dir).filter((n) => n.startsWith("jobs.json.bak-") && n.endsWith(`-console-${verb}`));
const snapshot = async (r: Rig) => (await fetch(`${r.base}/api/snapshot`)).json();
const stationOf = async (r: Rig, key: string) => (await snapshot(r)).stations.find((s: any) => s.key === key);

describe("worker controls against the fake CLI", () => {
  let r: Rig;
  beforeAll(async () => {
    r = await startRig(8123, 8124);
  });
  afterAll(async () => stopRig(r));

  test("AC-1: snapshot controls match each fixture state, with reasons", async () => {
    const snap = await snapshot(r);
    const c = Object.fromEntries(snap.stations.map((s: any) => [s.key, s.controls]));
    expect(Object.keys(c).sort()).toEqual(["build-agentic", "build-crm", "gatekeeper", "integrate", "review"]);
    expect(c.review.pause).toEqual({ enabled: false, reason: "Already paused" });
    expect(c.review.resume).toEqual({ enabled: true, reason: null });
    expect(c.review.run).toEqual({ enabled: false, reason: "Resume first" });
    expect(c["build-agentic"].run).toEqual({ enabled: false, reason: "Already running or dispatched" });
    expect(c["build-agentic"].pause.enabled).toBe(true);
    expect(c["build-agentic"].resume).toEqual({ enabled: false, reason: "Not paused" });
    expect(c.integrate.run.enabled).toBe(true); // ERROR does not block Run now
    expect(snap.logan.controls).toBeUndefined();
    expect(snap.zeus.controls).toBeUndefined();
    expect(snap.spec.controls).toBeUndefined();
    expect(snap.actions).toEqual({ hermes: { available: true, reason: null }, linear: { available: true, reason: null }, dryRun: false });
  });

  test("AC-3: resume then pause Review run the exact argv after a verified backup", async () => {
    const dir = join(r.home, "profiles", "reviewer", "cron");
    const before = sha(join(dir, "jobs.json"));
    const a = await post(r, "/api/actions/station/review/resume");
    expect(a.status).toBe(200);
    expect(await a.json()).toMatchObject({ ok: true, message: "Resumed · backup saved" });
    expect(sha(join(dir, backups(dir, "resume")[0]))).toBe(before);

    const mid = sha(join(dir, "jobs.json"));
    expect(mid).not.toBe(before);
    const b = await post(r, "/api/actions/station/review/pause");
    expect(await b.json()).toMatchObject({ ok: true, message: "Paused · backup saved" });
    expect(sha(join(dir, backups(dir, "pause")[0]))).toBe(mid);
    expect(backups(dir, "pause")[0]).toMatch(/^jobs\.json\.bak-\d{8}-\d{6}-console-pause$/);

    expect(argvLines(r).slice(-2)).toEqual([
      ["-p", "reviewer", "cron", "resume", "8e5c37a23b91"],
      ["-p", "reviewer", "cron", "pause", "8e5c37a23b91"],
    ]);
    expect((await stationOf(r, "review")).status).toBe("PAUSED");
  });

  test("AC-4: gatekeeper has no -p and backs up the home's cron/jobs.json", async () => {
    const dir = join(r.home, "cron");
    const before = sha(join(dir, "jobs.json"));
    expect((await post(r, "/api/actions/station/gatekeeper/pause")).status).toBe(200);
    expect(argvLines(r).at(-1)).toEqual(["cron", "pause", "1a9fb621f161"]);
    expect(sha(join(dir, backups(dir, "pause")[0]))).toBe(before);
    expect((await post(r, "/api/actions/station/gatekeeper/resume")).status).toBe(200);
    expect(argvLines(r).at(-1)).toEqual(["cron", "resume", "1a9fb621f161"]);
  });

  test("Pause on paused and Resume on enabled get 409 with no CLI call", async () => {
    const n = argvLines(r).length;
    expect((await post(r, "/api/actions/station/review/pause")).status).toBe(409);
    expect((await post(r, "/api/actions/station/integrate/resume")).status).toBe(409);
    expect(argvLines(r).length).toBe(n);
  });

  test("AC-7: Run now refused when WORKING, in flight or paused, with no CLI call", async () => {
    const n = argvLines(r).length;
    const working = await post(r, "/api/actions/station/build-agentic/run");
    expect(working.status).toBe(409);
    expect((await working.json()).error).toBe("Already running or dispatched");
    const paused = await post(r, "/api/actions/station/review/run");
    expect(paused.status).toBe(409);
    expect((await paused.json()).error).toBe("Resume first");
    expect(argvLines(r).length).toBe(n);
  });

  test("AC-6: Run now returns dispatched in under 2s while the fake run sleeps 60s; server stays responsive; a repeat is held", async () => {
    const t0 = performance.now();
    const res = await post(r, "/api/actions/station/build-crm/run");
    const ms = performance.now() - t0;
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ result: "dispatched" });
    expect(ms).toBeLessThan(2000);
    const h0 = performance.now();
    expect((await fetch(`${r.base}/api/health`)).status).toBe(200);
    expect(performance.now() - h0).toBeLessThan(500);
    for (let i = 0; i < 50 && !argvLines(r).some((a) => a.includes("run")); i++) await Bun.sleep(100);
    expect(argvLines(r).at(-1)).toEqual(["-p", "builder", "cron", "run", "1dd429fe03b2"]);
    // A second click before the run shows up must not double-fire.
    const n = argvLines(r).length;
    const again = await post(r, "/api/actions/station/build-crm/run");
    expect(again.status).toBe(409);
    expect((await stationOf(r, "build-crm")).controls.run.enabled).toBe(false);
    await Bun.sleep(300);
    expect(argvLines(r).length).toBe(n);
  });

  test("AC-8: forged requests get 403, no CLI call, no Linear write, and are logged", async () => {
    const n = argvLines(r).length;
    const w = r.mock.writes.length;
    const logged = logLines(r).length;
    const path = "/api/actions/station/integrate/pause";
    const noToken = await fetch(r.base + path, { method: "POST", headers: { Origin: ORIGIN, "Content-Type": "application/json" }, body: "{}" });
    expect(noToken.status).toBe(403);
    expect((await post(r, path, {}, { "X-Console-Token": "wrong" })).status).toBe(403);
    expect((await post(r, path, {}, { Origin: "http://evil.test" })).status).toBe(403);
    const noOrigin = await fetch(r.base + path, { method: "POST", headers: { "X-Console-Token": r.token, "Content-Type": "application/json" }, body: "{}" });
    expect(noOrigin.status).toBe(403);
    expect((await post(r, path, {}, { "Content-Type": "text/plain" })).status).toBe(403);
    expect((await post(r, "/api/actions/issue/FX-105/requeue", { reason: "forged request here" }, { Origin: "http://evil.test" })).status).toBe(403);
    expect(argvLines(r).length).toBe(n);
    expect(r.mock.writes.length).toBe(w);
    const fresh = logLines(r).slice(logged);
    expect(fresh.length).toBe(6);
    expect(fresh.every((l) => l.result === "forbidden")).toBe(true);
  });

  test("no CORS headers on any route, including a preflight", async () => {
    const urls = ["/api/session", "/api/actions/log", "/api/snapshot"];
    for (const u of urls) {
      const res = await fetch(r.base + u, { headers: { Origin: "http://evil.test" } });
      expect([...res.headers.keys()].filter((k) => k.startsWith("access-control"))).toEqual([]);
    }
    const pre = await fetch(`${r.base}/api/actions/station/review/pause`, { method: "OPTIONS", headers: { Origin: "http://evil.test", "Access-Control-Request-Method": "POST" } });
    expect(pre.status).toBe(405);
    expect([...pre.headers.keys()].filter((k) => k.startsWith("access-control"))).toEqual([]);
  });

  test("AC-9: unknown stations get 404, and body overrides are ignored", async () => {
    const n = argvLines(r).length;
    for (const id of ["a8004c5f3bab", "sloane", "logan", "zeus", "spec", "__proto__", "8e5c37a23b91"]) {
      expect((await post(r, `/api/actions/station/${id}/pause`)).status).toBe(404);
    }
    expect((await post(r, "/api/actions/station/review/remove")).status).toBe(404);
    expect((await post(r, "/api/actions/station/review/edit")).status).toBe(404);
    expect((await post(r, "/api/actions/issue/not%20an%20id/requeue", { reason: "long enough reason" })).status).toBe(404);
    expect(argvLines(r).length).toBe(n);
    const ok = await post(r, "/api/actions/station/review/resume", { profile: "default", jobId: "x", stationId: "gatekeeper" });
    expect(ok.status).toBe(200);
    expect(argvLines(r).at(-1)).toEqual(["-p", "reviewer", "cron", "resume", "8e5c37a23b91"]);
    expect((await post(r, "/api/actions/station/review/pause")).status).toBe(200);
  });

  test("AC-10: requeue moves to Todo and adds the exact comment", async () => {
    const res = await post(r, "/api/actions/issue/FX-105/requeue", { reason: "stuck two hours" });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ result: "ok" });
    expect(r.mock.writes.slice(-2)).toEqual([
      { op: "issueUpdate", variables: { id: "uuid-FX-105", stateId: "state-todo-fixture" } },
      { op: "commentCreate", variables: { issueId: "uuid-FX-105", body: "Requeued from Factory Console by Jonathan: stuck two hours" } },
    ]);
    expect(r.mock.authSeen.at(-1)).toBe("fake-test-key");
  });

  test("AC-11: refused issues and short reasons get 409 with no Linear write", async () => {
    const w = r.mock.writes.length;
    for (const id of ["FX-101", "FX-107", "FX-201", "FX-202", "FX-999", "FX-105"]) { // FX-105 is Todo now
      expect((await post(r, `/api/actions/issue/${id}/requeue`, { reason: "long enough reason" })).status).toBe(409);
    }
    expect((await post(r, "/api/actions/issue/FX-106/requeue", { reason: "short" })).status).toBe(409);
    expect((await post(r, "/api/actions/issue/FX-106/requeue", {})).status).toBe(409);
    expect((await post(r, "/api/actions/issue/FX-106/requeue", { reason: 12345678901 })).status).toBe(409);
    expect(r.mock.writes.length).toBe(w);
  });

  test("AC-12: every attempt wrote exactly one line; the log endpoint serves the last 50, newest first", async () => {
    const before = logLines(r).length;
    await post(r, "/api/actions/station/review/pause"); // refused
    await post(r, "/api/actions/station/sloane/pause"); // 404
    await post(r, "/api/actions/station/review/pause", {}, { Origin: "http://evil.test" }); // 403
    const lines = logLines(r);
    expect(lines.length).toBe(before + 3);
    expect(lines.slice(-3).map((l) => l.result)).toEqual(["refused", "not-found", "forbidden"]);
    const body = await (await fetch(`${r.base}/api/actions/log?limit=50`)).json();
    expect(body.entries.length).toBeLessThanOrEqual(50);
    expect(body.entries[0].result).toBe("forbidden");
    const raw = readFileSync(join(r.dataDir, "actions.jsonl"), "utf8");
    expect(raw).not.toContain(r.token);
    expect(raw).not.toContain("fake-test-key");
  });

  test("AC-13: a second action on the same station while one is in flight gets 409", async () => {
    await stopRig(r);
    r = await startRig(8123, 8124, { FAKE_HERMES_DELAY_MS: "1500" });
    const first = post(r, "/api/actions/station/integrate/pause");
    await Bun.sleep(200);
    const second = await post(r, "/api/actions/station/integrate/pause");
    expect(second.status).toBe(409);
    expect((await second.json()).error).toContain("in flight");
    // A different station is not blocked.
    expect((await post(r, "/api/actions/station/gatekeeper/pause")).status).toBe(200);
    expect((await first).status).toBe(200);
    expect(argvLines(r).filter((a) => a.includes("4e7a4d9c5fa4")).length).toBe(1);
  }, 15000);
});

describe("failure paths", () => {
  test("AC-5: when the backup cannot be written the action aborts and the CLI is not called", async () => {
    const r = await startRig(8123, 8124);
    const cron = join(r.home, "profiles", "integrator", "cron");
    const user = process.env.USERNAME!;
    try {
      execFileSync("icacls", [cron, "/deny", `${user}:(WD)`], { stdio: "ignore" });
      const res = await post(r, "/api/actions/station/integrate/pause");
      expect(res.status).toBe(500);
      expect((await res.json()).error).toContain("Backup failed");
      expect(argvLines(r)).toEqual([]);
      const last = logLines(r).at(-1);
      expect(last.result).toBe("failed");
      expect(last.backup).toBeNull();
    } finally {
      execFileSync("icacls", [cron, "/remove:d", user], { stdio: "ignore" });
      await stopRig(r);
    }
  }, 15000);

  test("CLI failure returns its redacted stderr", async () => {
    const r = await startRig(8123, 8124, { FAKE_HERMES_FAIL: "boom token=abc123" });
    try {
      const res = await post(r, "/api/actions/station/integrate/pause");
      expect(res.status).toBe(502);
      const body = await res.json();
      expect(body.error).toBe("boom [REDACTED]");
      expect(body.backup).toBeTruthy();
    } finally {
      await stopRig(r);
    }
  }, 15000);

  test("CLI missing disables Hermes controls and refuses", async () => {
    const r = await startRig(8123, 8124, { HERMES_EXE: join(tmpdir(), "wd555-does-not-exist.exe") });
    try {
      const st = await stationOf(r, "integrate");
      expect(st.controls.pause).toEqual({ enabled: false, reason: "hermes CLI not found" });
      expect((await snapshot(r)).actions.hermes).toEqual({ available: false, reason: "hermes CLI not found" });
      expect((await post(r, "/api/actions/station/integrate/pause")).status).toBe(409);
      expect(backups(join(r.home, "profiles", "integrator", "cron"), "pause")).toEqual([]);
    } finally {
      await stopRig(r);
    }
  }, 15000);

  test("fixture mode with no HERMES_EXE override never reaches the installed CLI", async () => {
    const r = await startRig(8123, 8124, { HERMES_EXE: "" });
    try {
      expect((await snapshot(r)).actions.hermes.available).toBe(false);
      expect((await post(r, "/api/actions/station/integrate/pause")).status).toBe(409);
      expect(logLines(r).at(-1).command).not.toContain("hermes.exe cron");
    } finally {
      await stopRig(r);
    }
  }, 15000);

  test("no key disables requeue; fixture mode without a mock URL also stays off", async () => {
    const r = await startRig(8123, 8124, { LINEAR_API_KEY: "" });
    try {
      expect((await snapshot(r)).actions.linear).toEqual({ available: false, reason: "Linear not connected" });
      expect((await post(r, "/api/actions/issue/FX-105/requeue", { reason: "long enough reason" })).status).toBe(409);
      expect(r.mock.authSeen).toEqual([]);
    } finally {
      await stopRig(r);
    }
    const r2 = await startRig(8123, 8124, { LINEAR_API_URL: "" });
    try {
      expect((await snapshot(r2)).actions.linear.available).toBe(false);
    } finally {
      await stopRig(r2);
    }
  }, 20000);
});

describe("dry run", () => {
  test("AC-14: logs the exact command and backup, changes nothing on disk or in Linear", async () => {
    const r = await startRig(8123, 8124, { FACTORY_ACTIONS_DRYRUN: "1" });
    try {
      const dir = join(r.home, "profiles", "reviewer", "cron");
      const before = sha(join(dir, "jobs.json"));
      const res = await post(r, "/api/actions/station/review/resume");
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.result).toBe("dry-run");
      expect(body.command).toEndWith("-p reviewer cron resume 8e5c37a23b91");
      expect(body.backup).toMatch(/jobs\.json\.bak-\d{8}-\d{6}-console-resume$/);
      const line = logLines(r).at(-1);
      expect(line.result).toBe("dry-run");
      expect(line.command).toEndWith("-p reviewer cron resume 8e5c37a23b91");
      expect(line.backup).toBe(body.backup);
      expect(existsSync(body.backup)).toBe(false);
      expect(sha(join(dir, "jobs.json"))).toBe(before);
      expect(backups(dir, "resume")).toEqual([]);
      expect(argvLines(r)).toEqual([]);

      const rq = await post(r, "/api/actions/issue/FX-105/requeue", { reason: "stuck two hours" });
      expect(rq.status).toBe(200);
      expect((await rq.json()).result).toBe("dry-run");
      expect(logLines(r).at(-1).command).toContain("Requeued from Factory Console by Jonathan: stuck two hours");
      expect(r.mock.writes).toEqual([]);

      const run = await post(r, "/api/actions/station/integrate/run");
      expect((await run.json()).result).toBe("dry-run");
      await Bun.sleep(200);
      expect(argvLines(r)).toEqual([]);
    } finally {
      await stopRig(r);
    }
  }, 15000);
});
