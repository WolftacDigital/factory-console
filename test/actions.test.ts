import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { backupJobs, backupPath, jobsJsonPath } from "../server/actions/backup";
import { ALLOWED_ORIGINS, checkGuards, createSessionToken } from "../server/actions/guard";
import { buildArgv, commandFor, defaultHermesExe, HERMES_VERBS, refusalFor, resolveHermesExe } from "../server/actions/hermes";
import { commentBody, issueRefusal, REQUEUE_FROM_STATES, requeueIssue, TARGET_STATE, reasonRefusal } from "../server/actions/linear";
import { ActionLog } from "../server/actions/log";
import { STATIONS } from "../server/stations";
import { createMockLinear } from "../fixtures/mock-linear/mock";

const FIXTURE_LINEAR = join(import.meta.dir, "..", "fixtures", "mixed", "linear.json");
const station = (k: string) => STATIONS.find((s) => s.key === k)!;
const sha = (p: string) => createHash("sha256").update(readFileSync(p)).digest("hex");

let tmp: string;
beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), "wd555-unit-"));
});
afterEach(() => {
  rmSync(tmp, { recursive: true, force: true });
});

describe("guard", () => {
  const token = createSessionToken();
  const good = (over: Record<string, string | null> = {}) => {
    const h = new Headers({ Origin: ALLOWED_ORIGINS[0], "X-Console-Token": token, "Content-Type": "application/json" });
    for (const [k, v] of Object.entries(over)) v === null ? h.delete(k) : h.set(k, v);
    return h;
  };

  test("token is 32 random bytes per call", () => {
    expect(token).toMatch(/^[0-9a-f]{64}$/);
    expect(createSessionToken()).not.toBe(token);
  });
  test("both 8095 origins pass", () => {
    expect(checkGuards(good(), token)).toEqual({ ok: true });
    expect(checkGuards(good({ Origin: "http://localhost:8095" }), token)).toEqual({ ok: true });
    expect(checkGuards(good({ "Content-Type": "application/json; charset=utf-8" }), token)).toEqual({ ok: true });
  });
  test.each([
    ["missing origin", { Origin: null }],
    ["evil origin", { Origin: "http://evil.test" }],
    ["other port", { Origin: "http://127.0.0.1:8096" }],
    ["suffix trick", { Origin: "http://127.0.0.1:8095.evil.test" }],
    ["https variant", { Origin: "https://127.0.0.1:8095" }],
    ["null origin", { Origin: "null" }],
    ["missing token", { "X-Console-Token": null }],
    ["wrong token", { "X-Console-Token": "0".repeat(64) }],
    ["text/plain", { "Content-Type": "text/plain" }],
    ["form", { "Content-Type": "application/x-www-form-urlencoded" }],
    ["no content type", { "Content-Type": null }],
  ] as [string, Record<string, string | null>][])("refuses %s", (_n, over) => {
    expect(checkGuards(good(over), token).ok).toBe(false);
  });
});

describe("action table", () => {
  test("the only CLI verbs are pause, resume and run", () => {
    expect([...HERMES_VERBS]).toEqual(["pause", "resume", "run"]);
    expect(() => buildArgv(station("review"), "remove" as any)).toThrow();
  });
  test("argv matches the station table exactly", () => {
    expect(buildArgv(station("review"), "pause")).toEqual(["-p", "reviewer", "cron", "pause", "8e5c37a23b91"]);
    expect(buildArgv(station("gatekeeper"), "resume")).toEqual(["cron", "resume", "1a9fb621f161"]);
    for (const s of STATIONS) for (const v of HERMES_VERBS) {
      const a = buildArgv(s, v);
      expect(a.slice(-3)).toEqual(["cron", v, s.jobId]);
      expect(a.length).toBe(s.profile === "default" ? 3 : 5);
    }
  });
  test("allow-list is exactly the five job stations and excludes rollback and other profiles", () => {
    expect(STATIONS.map((s) => s.key).sort()).toEqual(["build-agentic", "build-crm", "gatekeeper", "integrate", "review"]);
    expect(STATIONS.some((s) => ["sloane", "pepper", "cto", "factory-integrate"].includes(s.profile))).toBe(false);
  });
  test("the only Linear target state is Todo, from exactly three states", () => {
    expect(TARGET_STATE).toBe("Todo");
    expect([...REQUEUE_FROM_STATES]).toEqual(["In Progress", "In Review", "Approved"]);
  });

  test("source scan: no forbidden call in server/actions (comments excluded)", () => {
    const dir = join(import.meta.dir, "..", "server", "actions");
    const forbidden = /issueMerge|gh pr merge|slack|discord|reaction|state.*Done|"Approved"|cron (edit|remove|create)|gateway/;
    for (const f of readdirSync(dir)) {
      const code = readFileSync(join(dir, f), "utf8").split("\n").filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l)).join("\n");
      expect(code.match(forbidden)?.[0] ?? null).toBeNull();
    }
  });
  test("source scan: spawning happens only in hermes.ts, never through a shell", () => {
    const dir = join(import.meta.dir, "..", "server");
    const walk = (d: string): string[] => readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(join(d, e.name)) : [join(d, e.name)]));
    const spawners = walk(dir).filter((f) => /\bspawn\(|\bexec\(|execSync|Bun\.spawn/.test(readFileSync(f, "utf8")));
    expect(spawners.map((f) => f.replace(/\\/g, "/").split("/").pop())).toEqual(["hermes.ts"]);
    const src = readFileSync(join(dir, "actions", "hermes.ts"), "utf8");
    expect(src).not.toContain("shell: true");
  });
  test("the only Linear mutations are issueUpdate and commentCreate, on the requeue path", () => {
    const src = readFileSync(join(import.meta.dir, "..", "server", "actions", "linear.ts"), "utf8");
    expect([...src.matchAll(/mutation (\w+)/g)].map((m) => m[1])).toEqual(["RequeueState", "RequeueComment"]);
    expect(readFileSync(join(import.meta.dir, "..", "server", "sources", "linear.ts"), "utf8")).not.toMatch(/mutation \w+/);
  });
});

describe("hermes CLI resolution", () => {
  test("fixture mode without an override never uses the installed CLI", () => {
    expect(resolveHermesExe({ LOCALAPPDATA: "C:\\x" }, true)).toBeNull();
    expect(resolveHermesExe({ LOCALAPPDATA: "C:\\x", HERMES_EXE: "  " }, true)).toBeNull();
  });
  test("live default path and override", () => {
    expect(resolveHermesExe({ LOCALAPPDATA: "C:\\x" }, false)).toBe(defaultHermesExe({ LOCALAPPDATA: "C:\\x" }));
    expect(defaultHermesExe({ LOCALAPPDATA: "C:\\x" }).replace(/\\/g, "/")).toEndWith("hermes/hermes-agent/venv/Scripts/hermes.exe");
    expect(resolveHermesExe({ LOCALAPPDATA: "C:\\x", HERMES_EXE: "fixtures/fake-hermes/fake-hermes.ts" }, false)).toEndWith("fake-hermes.ts");
  });
  test("a script override runs under Bun as an argv array", () => {
    expect(commandFor("C:\\fake.ts", ["cron", "run", "x"])).toEqual({ file: process.execPath, args: ["C:\\fake.ts", "cron", "run", "x"] });
    expect(commandFor("C:\\h.exe", ["cron", "run", "x"])).toEqual({ file: "C:\\h.exe", args: ["cron", "run", "x"] });
  });
});

describe("refusal rules", () => {
  const now = Date.parse("2026-01-02T12:00:00Z");
  const iso = (minAgo: number) => new Date(now - minAgo * 60000).toISOString();
  const active = { id: "j", enabled: true, state: "scheduled", last_run_at: iso(300), last_status: "ok" };
  const paused = { ...active, state: "paused" };
  const f = (over: any = {}) => ({ job: active, status: "IDLE" as const, now, ...over });

  test("pause and resume follow the job state", () => {
    expect(refusalFor("pause", f())).toBeNull();
    expect(refusalFor("pause", f({ job: paused }))).toBe("Already paused");
    expect(refusalFor("pause", f({ job: { ...active, enabled: false } }))).toBe("Already paused");
    expect(refusalFor("resume", f())).toBe("Not paused");
    expect(refusalFor("resume", f({ job: paused }))).toBeNull();
  });
  test("run refused when WORKING, in-flight lane, paused, unknown or missing", () => {
    expect(refusalFor("run", f())).toBeNull();
    expect(refusalFor("run", f({ status: "WORKING" }))).toBe("Already running or dispatched");
    expect(refusalFor("run", f({ lane: { dispatched_at: iso(89) } }))).toBe("Already running or dispatched");
    expect(refusalFor("run", f({ job: paused }))).toBe("Resume first");
    expect(refusalFor("run", f({ status: "UNKNOWN" }))).toBe("Status unknown");
    expect(refusalFor("run", f({ job: null }))).toBe("Job not found");
  });
  test("run allowed when the lane dispatch is stale or older than the last run", () => {
    expect(refusalFor("run", f({ lane: { dispatched_at: iso(91) } }))).toBeNull();
    expect(refusalFor("run", f({ job: { ...active, last_run_at: iso(5) }, lane: { dispatched_at: iso(10) } }))).toBeNull();
  });
  test("ERROR status does not block run", () => {
    expect(refusalFor("run", f({ status: "ERROR" }))).toBeNull();
  });
  test("a console dispatch holds run until the run shows up or 90 minutes pass", () => {
    expect(refusalFor("run", f({ consoleDispatchedAt: now - 1000 }))).toBe("Already running or dispatched");
    expect(refusalFor("run", f({ consoleDispatchedAt: now - 1000, job: { ...active, last_run_at: new Date(now).toISOString() } }))).toBeNull();
    expect(refusalFor("run", f({ consoleDispatchedAt: now - 91 * 60000 }))).toBeNull();
  });
});

describe("backup", () => {
  const make = () => {
    const src = join(tmp, "profiles", "reviewer", "cron", "jobs.json");
    mkdirSync(dirname(src), { recursive: true });
    writeFileSync(src, '{"jobs":[]}\n');
    return src;
  };
  const when = new Date(2026, 0, 2, 3, 4, 5);

  test("path format and profile folders", () => {
    expect(backupPath("x/jobs.json", "pause", when)).toBe("x/jobs.json.bak-20260102-030405-console-pause");
    expect(jobsJsonPath("H", station("review")).replace(/\\/g, "/")).toBe("H/profiles/reviewer/cron/jobs.json");
    expect(jobsJsonPath("H", station("gatekeeper")).replace(/\\/g, "/")).toBe("H/cron/jobs.json");
  });
  test("writes a verified copy", async () => {
    const src = make();
    const r = await backupJobs(src, "pause", { now: () => when });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.path).toEndWith("jobs.json.bak-20260102-030405-console-pause");
      expect(sha(r.path)).toBe(sha(src));
    }
  });
  test("missing source fails", async () => {
    const r = await backupJobs(join(tmp, "nope", "jobs.json"), "pause");
    expect(r.ok).toBe(false);
  });
  test("write failure fails", async () => {
    const src = make();
    const r = await backupJobs(src, "resume", { copy: () => { const e: any = new Error("x"); e.code = "EACCES"; throw e; } });
    expect(r).toEqual({ ok: false, error: "backup could not be written (EACCES)" });
  });
  test("hash mismatch fails and removes the bad copy", async () => {
    const src = make();
    const seen: string[] = [];
    const r = await backupJobs(src, "pause", { copy: (_f, to) => { seen.push(to); writeFileSync(to, "corrupt"); } });
    expect(r).toEqual({ ok: false, error: "backup hash mismatch" });
    expect(existsSync(seen[0])).toBe(false);
  });
  test("same-second collision waits for the next stamp and never overwrites", async () => {
    const src = make();
    let t = when.getTime();
    const deps = { now: () => new Date(t), wait: async () => { t += 1100; } };
    const a = await backupJobs(src, "pause", deps);
    const b = await backupJobs(src, "pause", deps);
    expect(a.ok && b.ok && a.path !== b.path).toBe(true);
  });
});

describe("requeue", () => {
  const go = async (id: string, reason = "stuck for two hours", mockOpts: any = {}, dryRun = false) => {
    const mock = createMockLinear({ fixture: FIXTURE_LINEAR, ...mockOpts });
    const out = await requeueIssue({ apiKey: "fake-key", url: "http://mock.invalid/graphql", fetchImpl: ((_u: string, init: any) => mock.fetch(new Request("http://mock.invalid/graphql", init))) as any }, id, reason, { dryRun });
    return { out, mock };
  };

  test.each(["FX-103", "FX-105", "FX-106"])("moves eligible %s to Todo and comments with the exact text", async (id) => {
    const { out, mock } = await go(id);
    expect(out.kind).toBe("moved");
    expect(mock.writes).toEqual([
      { op: "issueUpdate", variables: { id: `uuid-${id}`, stateId: "state-todo-fixture" } },
      { op: "commentCreate", variables: { issueId: `uuid-${id}`, body: "Requeued from Factory Console by Jonathan: stuck for two hours" } },
    ]);
  });
  test.each([["FX-101", "Todo"], ["FX-107", "Done"], ["FX-201", "unlabeled"], ["FX-202", "other team"], ["FX-999", "missing"]])("refuses %s (%s) with no writes", async (id) => {
    const { out, mock } = await go(id);
    expect(out.kind).toBe("refused");
    expect(mock.writes).toEqual([]);
  });
  test("comment failure is partial and the state is not rolled back", async () => {
    const { out, mock } = await go("FX-105", "stuck for two hours", { failComment: true });
    expect(out.kind).toBe("partial");
    expect(mock.writes.map((w) => w.op)).toEqual(["issueUpdate", "commentCreate"]);
    expect(mock.issues.find((i) => i.identifier === "FX-105")!.state).toBe("Todo");
  });
  test("dry run plans and writes nothing", async () => {
    const { out, mock } = await go("FX-105", "stuck for two hours", {}, true);
    expect(out).toMatchObject({ kind: "planned", from: "In Review", stateId: "state-todo-fixture" });
    expect(mock.writes).toEqual([]);
  });
  test("state id comes from the team lookup; a team without Todo fails with no writes", async () => {
    const f = (async () => Response.json({ data: { issue: { id: "u", state: { name: "In Review" }, labels: { nodes: [{ name: "Factory Queue" }] }, team: { name: "Wolftac Digital", states: { nodes: [{ id: "x", name: "Backlog" }] } } } } })) as any;
    expect((await requeueIssue({ apiKey: "k", url: "http://mock.invalid", fetchImpl: f }, "FX-1", "stuck for two hours")).kind).toBe("failed");
  });
  test("filter and reason rules", () => {
    const ok = { team: "Wolftac Digital", labels: ["Factory Queue"], state: "In Review" };
    expect(issueRefusal(ok)).toBeNull();
    expect(issueRefusal({ ...ok, state: "Done" })).toContain("Done");
    expect(issueRefusal({ ...ok, state: "Todo" })).toContain("Todo");
    expect(issueRefusal({ ...ok, labels: [] })).toContain("Factory Queue");
    expect(issueRefusal({ ...ok, team: "x" })).toContain("team");
    expect(reasonRefusal("short")).not.toBeNull();
    expect(reasonRefusal("         a          ")).not.toBeNull();
    expect(reasonRefusal(undefined)).not.toBeNull();
    expect(reasonRefusal("1234567890")).toBeNull();
    expect(reasonRefusal("x".repeat(1001))).not.toBeNull();
  });
  test("a secret in the reason is redacted from the comment", () => {
    expect(commentBody("uses lin_api_FAKE123 somewhere")).toBe("Requeued from Factory Console by Jonathan: uses [REDACTED] somewhere");
  });
});

describe("action log", () => {
  const entry = { action: "pause", result: "ok" };

  test("appends one redacted line with every field", () => {
    const log = new ActionLog(tmp);
    log.append({ ...entry, target: "review", reason: "token=abc123 was bad", error: "Bearer xyz" });
    const lines = readFileSync(log.file, "utf8").trim().split("\n");
    expect(lines.length).toBe(1);
    const e = JSON.parse(lines[0]);
    expect(Object.keys(e).sort()).toEqual(["action", "backup", "durationMs", "error", "issue", "jobId", "profile", "reason", "result", "target", "ts"]);
    expect(e.reason).toBe("[REDACTED] was bad");
    expect(e.error).toBe("[REDACTED]");
  });
  test("recent is newest first and limited", () => {
    const log = new ActionLog(tmp);
    for (let i = 0; i < 60; i++) log.append({ ...entry, target: `t${i}` });
    const r = log.recent(50);
    expect(r.length).toBe(50);
    expect(r[0].target).toBe("t59");
    expect(r[49].target).toBe("t10");
  });
  test("rotates at the limit, keeps 5, and recent reads across files", () => {
    const log = new ActionLog(tmp, 200, 5);
    for (let i = 0; i < 80; i++) log.append({ ...entry, target: `t${i}` });
    const rotated = readdirSync(tmp).filter((n) => n.startsWith("actions-"));
    expect(rotated.length).toBe(5);
    for (const n of rotated) expect(n).toMatch(/^actions-\d{8}-\d{6}-\d{3}(-\d+)?\.jsonl$/);
    expect(existsSync(log.file)).toBe(true);
    expect(log.recent(1)[0].target).toBe("t79");
    expect(log.recent(8).length).toBe(8);
  });
  test("empty log returns nothing", () => {
    expect(new ActionLog(join(tmp, "absent")).recent()).toEqual([]);
  });
  test("a log write failure does not throw", () => {
    const blocker = join(tmp, "file");
    writeFileSync(blocker, "x");
    const orig = console.error;
    console.error = () => {};
    try {
      expect(() => new ActionLog(join(blocker, "sub")).append(entry)).not.toThrow();
    } finally {
      console.error = orig;
    }
  });
});

test("the shipped fixture stays synthetic: copies used in tests come from fixtures/mixed", () => {
  const dest = join(tmp, "copy");
  cpSync(join(import.meta.dir, "..", "fixtures", "mixed"), dest, { recursive: true });
  expect(existsSync(join(dest, "profiles", "reviewer", "cron", "jobs.json"))).toBe(true);
});
