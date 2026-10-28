import { describe, expect, test } from "bun:test";
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { JOB_FIELDS, pickJob, readHermes } from "../server/sources/hermes";
import { buildSnapshot } from "../server/snapshot";
import { readLinearFixture } from "../server/sources/linear";

const root = resolve(import.meta.dir, "..");
const fixture = join(root, "fixtures/mixed");
// Deliberately synthetic. Never copy live source values into a regression fixture.
const payload = { prompt: "SYNTHETIC_PRIVATE_SENTINEL", argv: ["SYNTHETIC_ARGV"], pid: 424242, secret: "lin_api_SYNTHETIC_SENTINEL" };
const forbidden = /SYNTHETIC_PRIVATE_SENTINEL|SYNTHETIC_ARGV|424242|lin_api_|"prompt"|"argv"|"pid"/;
function snapshot(home: string) {
  return buildSnapshot(readHermes(home, { fixtures: true }), null, readLinearFixture(join(home, "linear.json")), { configured: false }, Date.now(), "fixtures");
}
function withFixture(fn: (home: string) => void) {
  const home = mkdtempSync(join(tmpdir(), "factory-boundary-"));
  try { cpSync(fixture, home, { recursive: true }); fn(home); }
  finally { rmSync(home, { recursive: true, force: true }); }
}

describe("Hermes field schemas", () => {
  for (const field of JOB_FIELDS) {
    test(`rejects nested private data in ${field}`, () => {
      for (const value of [payload, [payload]]) {
        expect(() => pickJob({ id: "synthetic", [field]: value })).toThrow();
      }
    });
  }
  test("rejects scalar type confusion and non-timestamp strings", () => {
    for (const [field, value] of [
      ["last_run_at", "lin_api_SYNTHETIC_SENTINEL"], ["next_run_at", 123], ["paused_at", true],
      ["enabled", "false"], ["skills", ["ok", 42]], ["failure_streak", "0"],
      ["failure_streak", -1], ["failure_streak", Infinity], ["model", 42],
    ] as const) expect(() => pickJob({ id: "synthetic", [field]: value })).toThrow();
  });
  for (const field of ["last_run_at", "next_run_at", "paused_at", "last_error", "skills"]) {
    test(`malformed ${field} degrades affected profile and recovers`, () => withFixture((home) => {
      const path = join(home, "profiles/builder/cron/jobs.json");
      const original = readFileSync(path, "utf8");
      const data = JSON.parse(original);
      data.jobs[0][field] = payload;
      writeFileSync(path, JSON.stringify(data));
      const s = snapshot(home);
      expect(s.stations.find((s) => s.key === "build-agentic")?.status).toBe("UNKNOWN");
      expect(s.stations.find((s) => s.key === "review")?.status).toBe("PAUSED");
      expect(JSON.stringify(s)).not.toMatch(forbidden);
      writeFileSync(path, original);
      expect(snapshot(home).stations.find((s) => s.key === "build-agentic")?.status).toBe("WORKING");
    }));
  }
  test("rollback timestamps cannot smuggle nested fields", () => withFixture((home) => {
    const path = join(home, "cron/jobs.json");
    const data = JSON.parse(readFileSync(path, "utf8"));
    data.jobs.find((j: any) => j.id === "a1ca59d16be5").paused_at = payload;
    writeFileSync(path, JSON.stringify(data));
    const s = snapshot(home);
    expect(s.stations.find((s) => s.key === "gatekeeper")?.status).toBe("UNKNOWN");
    expect(s.logan.rollbackJobs).toEqual([]);
    expect(JSON.stringify(s)).not.toMatch(forbidden);
  }));
  test("gatekeeper timestamps reject objects", () => withFixture((home) => {
    const path = join(home, "cron/gatekeeper-state.json");
    const data = JSON.parse(readFileSync(path, "utf8"));
    data.lanes.build.dispatched_at = payload;
    writeFileSync(path, JSON.stringify(data));
    const s = snapshot(home);
    expect(s.stations.find((s) => s.key === "build-agentic")?.status).toBe("UNKNOWN");
    expect(JSON.stringify(s)).not.toMatch(forbidden);
  }));
  for (const field of ["gateway_state", "active_agents", "platforms"]) {
    test(`gateway ${field} rejects malformed fields`, () => withFixture((home) => {
      const path = join(home, "gateway_state.json");
      const data = JSON.parse(readFileSync(path, "utf8"));
      data[field] = payload;
      writeFileSync(path, JSON.stringify(data));
      const s = snapshot(home);
      expect(s.logan.status).toBe("UNKNOWN");
      expect(JSON.stringify(s)).not.toMatch(forbidden);
    }));
  }
});

test("real HTTP and SSE reject the review payload; malformed URLs return 400", async () => {
  const home = mkdtempSync(join(tmpdir(), "factory-http-"));
  cpSync(fixture, home, { recursive: true });
  const path = join(home, "profiles/builder/cron/jobs.json");
  const data = JSON.parse(readFileSync(path, "utf8"));
  data.jobs[0].last_run_at = payload;
  writeFileSync(path, JSON.stringify(data));
  // Wrap only server lifetime: execute the shipped entrypoint and its real HTTP handler.
  // stdin requests graceful closure; the bounded watchdog prevents orphan test servers.
  const wrapper = `
    const serve = Bun.serve; let server;
    Bun.serve = (opts) => { server = serve(opts); console.log('READY_PORT=' + server.port); return server; };
    const close = async () => { if (server) await server.stop(true); process.exit(0); };
    process.stdin.once('data', close); process.stdin.resume();
    setTimeout(close, 25000);
    await import('./server/index.ts');
  `;
  const env: Record<string, string> = { FACTORY_FIXTURES: home, PORT: "0" };
  for (const k of ["PATH", "SystemRoot", "TEMP", "TMP", "TMPDIR"]) if (process.env[k]) env[k] = process.env[k]!;
  const child = Bun.spawn([process.execPath, "--no-env-file", "-e", wrapper], { cwd: root, env, stdin: "pipe", stdout: "pipe", stderr: "pipe" });
  try {
    let output = "";
    const reader = child.stdout.getReader();
    let port: string | undefined;
    while (!port) {
      const { value, done } = await reader.read();
      if (done) throw new Error(`server exited before readiness: ${output}`);
      output += new TextDecoder().decode(value);
      port = output.match(/READY_PORT=(\d+)/)?.[1];
    }
    reader.releaseLock();
    const base = `http://127.0.0.1:${port}`;
    for (const path of ["/%ZZ", "/%E0%A4%A", "/%00"]) {
      const r = await fetch(base + path);
      expect(r.status).toBe(400);
      expect(r.headers.get("content-security-policy")).toContain("frame-ancestors");
    }
    const response = await fetch(base + "/api/snapshot");
    expect(response.status).toBe(200);
    const text = await response.text();
    expect(text).not.toMatch(forbidden);
    expect(JSON.parse(text).stations.find((s: any) => s.key === "build-agentic").status).toBe("UNKNOWN");
    const stream = await fetch(base + "/api/stream");
    const sr = stream.body!.getReader();
    let event = "";
    while (!event.includes("\n\n")) event += new TextDecoder().decode((await sr.read()).value);
    await sr.cancel();
    expect(event).toContain("event: snapshot");
    expect(event).not.toMatch(forbidden);
    expect((await fetch(base + "/api/health")).status).toBe(200);
  } finally {
    child.stdin.write("close\n");
    child.stdin.end();
    expect(await child.exited).toBe(0);
    rmSync(home, { recursive: true, force: true });
  }
}, 30000);
