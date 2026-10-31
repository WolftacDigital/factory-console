import { describe, expect, test } from "bun:test";
import { crmJobStatus, currentIssue, gatekeeperStatus, laneJobStatus, loganStatus, zeusStatus, createdLast24h, type IssueLite, type JobFields } from "../server/status";

const NOW = Date.parse("2026-06-01T12:00:00Z");
const ago = (min: number) => new Date(NOW - min * 60_000).toISOString();
const job = (o: Partial<JobFields> = {}): JobFields => ({ id: "j1", enabled: true, state: "scheduled", last_run_at: ago(120), last_status: "ok", failure_streak: 0, ...o });
const issue = (o: Partial<IssueLite>): IssueLite => ({ identifier: "X-1", title: "t", url: "https://linear.app/x", state: "In Progress", labels: ["Factory Queue"], project: null, assignee: null, delegate: null, createdAt: ago(600), updatedAt: ago(10), ...o });

describe("laneJobStatus", () => {
  test("PAUSED when enabled === false", () => expect(laneJobStatus(job({ enabled: false }), undefined, NOW).status).toBe("PAUSED"));
  test("PAUSED when state === paused", () => expect(laneJobStatus(job({ state: "paused" }), { dispatched_at: ago(5) }, NOW).status).toBe("PAUSED"));
  test("WORKING when dispatched after last run and < 90 min old", () => expect(laneJobStatus(job(), { dispatched_at: ago(30) }, NOW).status).toBe("WORKING"));
  test("not WORKING when dispatch is 90+ min old", () => expect(laneJobStatus(job({ last_run_at: ago(200) }), { dispatched_at: ago(91) }, NOW).status).toBe("IDLE"));
  test("WORKING just inside the 90-minute window", () => expect(laneJobStatus(job({ last_run_at: ago(200) }), { dispatched_at: ago(89) }, NOW).status).toBe("WORKING"));
  test("not WORKING when last run is after dispatch", () => expect(laneJobStatus(job({ last_run_at: ago(5) }), { dispatched_at: ago(30) }, NOW).status).toBe("IDLE"));
  test("ERROR when last_status !== ok", () => expect(laneJobStatus(job({ last_status: "error" }), undefined, NOW).status).toBe("ERROR"));
  test("ERROR when failure_streak > 0", () => expect(laneJobStatus(job({ failure_streak: 1 }), undefined, NOW).status).toBe("ERROR"));
  test("IDLE otherwise", () => expect(laneJobStatus(job(), { dispatched_at: ago(300) }, NOW).status).toBe("IDLE"));
  test("UNKNOWN with reason when job missing", () => {
    const r = laneJobStatus(undefined, undefined, NOW, "missing cron/jobs.json");
    expect(r.status).toBe("UNKNOWN");
    expect(r.reason).toBe("missing cron/jobs.json");
  });
  test("UNKNOWN with reason when gatekeeper-state unavailable", () => {
    const r = laneJobStatus(job(), undefined, NOW, "gatekeeper-state unavailable");
    expect(r).toEqual({ status: "UNKNOWN", reason: "gatekeeper-state unavailable" });
  });
});

describe("crmJobStatus", () => {
  const P = "Wolftac CRM v2";
  test("WORKING when CRM In Progress issue updated after last run and < 90 min", () =>
    expect(crmJobStatus(job({ last_run_at: ago(60) }), [issue({ project: P, updatedAt: ago(20) })], NOW, P).status).toBe("WORKING"));
  test("not WORKING when update is before last run", () =>
    expect(crmJobStatus(job({ last_run_at: ago(10) }), [issue({ project: P, updatedAt: ago(20) })], NOW, P).status).toBe("IDLE"));
  test("not WORKING when update older than 90 min", () =>
    expect(crmJobStatus(job({ last_run_at: ago(300) }), [issue({ project: P, updatedAt: ago(95) })], NOW, P).status).toBe("IDLE"));
  test("not WORKING for other projects or states", () =>
    expect(crmJobStatus(job({ last_run_at: ago(60) }), [issue({ project: "Other", updatedAt: ago(5) }), issue({ project: P, state: "Todo", updatedAt: ago(5) })], NOW, P).status).toBe("IDLE"));
  test("ERROR fallback", () => expect(crmJobStatus(job({ last_status: "error" }), [], NOW, P).status).toBe("ERROR"));
  test("PAUSED wins", () => expect(crmJobStatus(job({ enabled: false }), [issue({ project: P })], NOW, P).status).toBe("PAUSED"));
  test("UNKNOWN when job missing", () => expect(crmJobStatus(undefined, [], NOW, P).status).toBe("UNKNOWN"));
});

describe("gatekeeperStatus", () => {
  test("IDLE when ok and not due", () => expect(gatekeeperStatus(job({ next_run_at: ago(-10) }), NOW).status).toBe("IDLE"));
  test("WORKING while due run is firing", () => expect(gatekeeperStatus(job({ next_run_at: ago(1) }), NOW).status).toBe("WORKING"));
  test("PAUSED", () => expect(gatekeeperStatus(job({ state: "paused" }), NOW).status).toBe("PAUSED"));
  test("ERROR", () => expect(gatekeeperStatus(job({ last_status: "error", next_run_at: ago(-10) }), NOW).status).toBe("ERROR"));
  test("UNKNOWN", () => expect(gatekeeperStatus(undefined, NOW, "x").reason).toBe("x"));
});

describe("logan / zeus / spec", () => {
  test("Logan WORKING when active_agents > 0", () => expect(loganStatus({ gateway_state: "running", active_agents: 2 }).status).toBe("WORKING"));
  test("Logan IDLE when running", () => expect(loganStatus({ gateway_state: "running", active_agents: 0 }).status).toBe("IDLE"));
  test("Logan ERROR otherwise", () => expect(loganStatus({ gateway_state: "stopped", active_agents: 0 }).status).toBe("ERROR"));
  test("Logan UNKNOWN when missing", () => expect(loganStatus(undefined, "missing").status).toBe("UNKNOWN"));
  test("Zeus maps states", () => {
    expect(zeusStatus("working", "").status).toBe("WORKING");
    expect(zeusStatus("paused", "").status).toBe("PAUSED");
    expect(zeusStatus("bogus", "r").status).toBe("UNKNOWN");
  });
  test("created last 24h", () => expect(createdLast24h([issue({ createdAt: ago(60) }), issue({ createdAt: ago(25 * 60) })], NOW)).toBe(1));
});

describe("currentIssue", () => {
  const issues = [
    issue({ identifier: "A-2", labels: ["Factory Queue", "agentic"], createdAt: ago(50) }),
    issue({ identifier: "A-1", labels: ["Factory Queue", "agentic"], createdAt: ago(100) }),
    issue({ identifier: "C-1", project: "Wolftac CRM v2" }),
    issue({ identifier: "R-2", state: "In Review", createdAt: ago(10) }),
    issue({ identifier: "R-1", state: "In Review", createdAt: ago(20) }),
    issue({ identifier: "AP-1", state: "Approved" }),
  ];
  test("build agentic -> In Progress with agentic label", () => expect(currentIssue("build-agentic", issues, "Wolftac CRM v2")?.identifier).toBe("A-1"));
  test("build crm -> In Progress in CRM project", () => expect(currentIssue("build-crm", issues, "Wolftac CRM v2")?.identifier).toBe("C-1"));
  test("review -> oldest In Review", () => expect(currentIssue("review", issues, "x")?.identifier).toBe("R-1"));
  test("integrate -> oldest Approved", () => expect(currentIssue("integrate", issues, "x")?.identifier).toBe("AP-1"));
  test("no match -> null (picking up work)", () => expect(currentIssue("integrate", [], "x")).toBeNull());
});
