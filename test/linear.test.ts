import { describe, expect, test } from "bun:test";
import { fetchLinearIssues, LINEAR_URL, boardColumns } from "../server/sources/linear";

const node = (id: string, state = "Todo") => ({
  identifier: id, title: `T ${id}`, url: `https://linear.app/x/issue/${id}`, createdAt: "2026-01-01T00:00:00Z", updatedAt: "2026-01-01T00:00:00Z", completedAt: null,
  state: { name: state }, labels: { nodes: [{ name: "Factory Queue" }, { name: "agentic" }] }, project: { name: "P" }, assignee: { name: "A" }, delegate: null,
});
const page = (nodes: any[], hasNextPage: boolean, endCursor: string | null) => new Response(JSON.stringify({ data: { issues: { nodes, pageInfo: { hasNextPage, endCursor } } } }), { status: 200 });

describe("fetchLinearIssues", () => {
  test("success maps fields and sends the key as Authorization", async () => {
    let seen: any;
    const f = (async (url: string, init: any) => {
      seen = { url, init };
      return page([node("WD-1")], false, null);
    }) as unknown as typeof fetch;
    const r = await fetchLinearIssues("lin_api_FAKE", f);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.issues[0]).toMatchObject({ identifier: "WD-1", state: "Todo", labels: ["Factory Queue", "agentic"], project: "P", assignee: "A", delegate: null });
    expect(seen.url).toBe(LINEAR_URL);
    expect(seen.init.headers.Authorization).toBe("lin_api_FAKE");
    const body = JSON.parse(seen.init.body);
    expect(body.variables.filter.team.name.eq).toBe("Wolftac Digital");
    expect(body.variables.filter.labels.name.eq).toBe("Factory Queue");
    expect(body.query).not.toMatch(/mutation/);
  });

  test("paginates fully", async () => {
    const afters: (string | null)[] = [];
    const f = (async (_u: string, init: any) => {
      const after = JSON.parse(init.body).variables.after;
      afters.push(after);
      if (after === null) return page([node("WD-1")], true, "c1");
      if (after === "c1") return page([node("WD-2")], true, "c2");
      return page([node("WD-3", "Done")], false, null);
    }) as unknown as typeof fetch;
    const r = await fetchLinearIssues("k", f);
    expect(r.ok && r.issues.map((i) => i.identifier)).toEqual(["WD-1", "WD-2", "WD-3"]);
    expect(afters).toEqual([null, "c1", "c2"]);
  });

  test("401 -> disconnected with reason", async () => {
    const f = (async () => new Response("{}", { status: 401 })) as unknown as typeof fetch;
    const r = await fetchLinearIssues("lin_api_invalid", f);
    expect(r).toEqual({ ok: false, reason: "HTTP 401: invalid or unauthorized LINEAR_API_KEY" });
  });

  test("GraphQL authentication error -> disconnected", async () => {
    const f = (async () => new Response(JSON.stringify({ errors: [{ message: "Authentication required", extensions: { code: "AUTHENTICATION_ERROR" } }] }), { status: 200 })) as unknown as typeof fetch;
    const r = await fetchLinearIssues("bad", f);
    expect(r.ok).toBe(false);
  });

  test("network error -> disconnected", async () => {
    const f = (async () => {
      throw new TypeError("fetch failed");
    }) as unknown as typeof fetch;
    const r = await fetchLinearIssues("k", f);
    expect(r).toEqual({ ok: false, reason: "network error: fetch failed" });
  });

  test("missing key -> disconnected without calling fetch", async () => {
    let called = false;
    const f = (async () => {
      called = true;
      return page([], false, null);
    }) as unknown as typeof fetch;
    expect(await fetchLinearIssues(undefined, f)).toEqual({ ok: false, reason: "LINEAR_API_KEY not set" });
    expect(called).toBe(false);
  });
});

describe("boardColumns", () => {
  test("drops Done older than 7 days and keeps all five columns", () => {
    const now = Date.parse("2026-01-10T00:00:00Z");
    const mk = (id: string, state: string, completedAt: string | null = null) => ({ identifier: id, title: id, url: "", state, labels: [], project: null, assignee: null, delegate: null, createdAt: "2026-01-01T00:00:00Z", updatedAt: "2026-01-01T00:00:00Z", completedAt });
    const cols = boardColumns([mk("a", "Todo"), mk("b", "Done", "2026-01-09T00:00:00Z"), mk("c", "Done", "2025-12-01T00:00:00Z")], now);
    expect(Object.keys(cols)).toEqual(["Todo", "In Progress", "In Review", "Approved", "Done"]);
    expect(cols.Done.map((i) => i.identifier)).toEqual(["b"]);
  });
});
