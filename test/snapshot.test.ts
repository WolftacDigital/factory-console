import { describe, expect, test } from "bun:test";
import { join } from "node:path";
import { buildSnapshot } from "../server/snapshot";
import { readHermes, pickJob, JOB_FIELDS, outputExcerpt } from "../server/sources/hermes";
import { readLinearFixture } from "../server/sources/linear";
import { FIXTURE_ANCHOR } from "../server/fixtime";
import { parseDefaultJobMap, jobMapMismatches } from "../server/stations";

const FIX = join(import.meta.dir, "..", "fixtures", "mixed");

describe("snapshot allow-list", () => {
  test("pickJob keeps only allow-listed fields", () => {
    const raw = { id: "x", prompt: "P", base_url: "u", deliver: "d", origin: "o", provider_snapshot: {}, model_snapshot: {}, enabled_toolsets: [], workdir: "w", fire_claim: {}, model: "m" };
    const out = pickJob(raw);
    expect(Object.keys(out).sort()).toEqual(["id", "model"]);
    for (const k of Object.keys(out)) expect(JOB_FIELDS as readonly string[]).toContain(k);
  });

  test("fixture snapshot contains no prompt, argv, pid, credentials", () => {
    const h = readHermes(FIX, { fixtures: true });
    const snap = buildSnapshot(h, null, readLinearFixture(join(FIX, "linear.json")), { configured: false }, FIXTURE_ANCHOR, "fixtures");
    const text = JSON.stringify(snap);
    expect(text).not.toMatch(/"prompt"|"argv"|"pid"|"writer_pid"|"base_url"|"workdir"/);
    expect(text).not.toContain("FIXTURE PROMPT MUST NEVER APPEAR");
    expect(text).not.toContain("fixture-not-a-real");
    expect(text).not.toContain("FAKE-fixture-value");
    expect(text).not.toMatch(/lin_api_|xox[abposr]-|sk-[\w-]{10,}|gh[pousr]_/);
  });

  test("fixture statuses: one WORKING, IDLE, PAUSED, ERROR", () => {
    const h = readHermes(FIX, { fixtures: true });
    const snap = buildSnapshot(h, null, readLinearFixture(join(FIX, "linear.json")), { configured: false }, FIXTURE_ANCHOR, "fixtures");
    const by = Object.fromEntries(snap.stations.map((s) => [s.key, s.status]));
    expect(by).toEqual({ gatekeeper: "IDLE", "build-agentic": "WORKING", "build-crm": "IDLE", review: "PAUSED", integrate: "ERROR" });
    const agentic = snap.stations.find((s) => s.key === "build-agentic")!;
    expect(agentic.currentIssue?.identifier).toBe("FX-103");
    expect(snap.logan.rollbackJobs.map((r) => r.id).sort()).toEqual(["66efec8197dc", "a1ca59d16be5", "a5d6e054f3fa", "a8004c5f3bab"]);
    expect(snap.stations.some((s) => s.jobId.startsWith("a1ca"))).toBe(false);
    expect(snap.board!.columns.map((c) => c.cards.length)).toEqual([2, 2, 1, 1, 1]);
    expect(snap.warnings).toEqual([]);
  });

  test("output excerpt is <= 60 lines and never includes the prompt section", () => {
    const text = "# h\n\n## Prompt\nSECRET PROMPT\n## Response\n" + Array.from({ length: 100 }, (_, i) => `l${i}`).join("\n");
    const ex = outputExcerpt(text);
    expect(ex.length).toBe(60);
    expect(ex.join("\n")).not.toContain("SECRET PROMPT");
  });

  test("missing Hermes home -> UNKNOWN with reasons, no throw", () => {
    const h = readHermes(join(FIX, "does-not-exist"));
    const snap = buildSnapshot(h, null, { ok: false, reason: "LINEAR_API_KEY not set" }, { configured: false }, Date.now(), "live");
    expect(snap.stations.every((s) => s.status === "UNKNOWN" && s.reason.length > 0)).toBe(true);
    expect(snap.logan.status).toBe("UNKNOWN");
    expect(snap.board).toBeNull();
    expect(snap.zeus.label).toBe("Remote · status unknown");
  });
});

describe("DEFAULT_JOB_MAP cross-check", () => {
  const src = `X = 1\nDEFAULT_JOB_MAP = {\n    "build": ("Todo", "9b7b5987bcd6", "builder"),\n    "review": ("In Review", "8e5c37a23b91", "reviewer"),\n    "integrate": ("Approved", "4e7a4d9c5fa4", "integrator"),\n}\nY = 2\n`;
  test("matching map -> no mismatch", () => expect(jobMapMismatches(parseDefaultJobMap(src)!)).toEqual([]));
  test("changed review id -> mismatch names review", () => expect(jobMapMismatches(parseDefaultJobMap(src.replace("8e5c37a23b91", "000000000000"))!)).toEqual(["review"]));
  test("missing lane -> mismatch", () => expect(jobMapMismatches(parseDefaultJobMap(src.replace(/ {4}"integrate".*\n/, ""))!)).toEqual(["integrate"]));
});
