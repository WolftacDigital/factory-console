// Mock Linear GraphQL endpoint for tests. Synthetic data only. Records every write it receives.
import { readFileSync, writeFileSync } from "node:fs";

export interface MockIssue { id: string; identifier: string; state: string; labels: string[]; team: string }
export interface MockWrite { op: "issueUpdate" | "commentCreate"; variables: Record<string, any> }
export interface MockOptions {
  /** A linear.json (fixtures/mixed format). Its issues are served in team Wolftac Digital. */
  fixture?: string;
  /** Persist state changes back into the fixture file, so the board updates. Only pass a temp copy. */
  persist?: boolean;
  failComment?: boolean;
}

export const TEAM_STATES = [
  { id: "state-todo-fixture", name: "Todo" },
  { id: "state-progress-fixture", name: "In Progress" },
  { id: "state-review-fixture", name: "In Review" },
  { id: "state-approved-fixture", name: "Approved" },
  { id: "state-done-fixture", name: "Done" },
];

const EXTRA: MockIssue[] = [
  { id: "uuid-FX-201", identifier: "FX-201", state: "In Review", labels: ["agentic"], team: "Wolftac Digital" },
  { id: "uuid-FX-202", identifier: "FX-202", state: "In Review", labels: ["Factory Queue"], team: "Other Fixture Team" },
];

export function createMockLinear(opts: MockOptions = {}) {
  const issues: MockIssue[] = [...EXTRA.map((i) => ({ ...i }))];
  if (opts.fixture) {
    for (const n of JSON.parse(readFileSync(opts.fixture, "utf8")).issues) {
      issues.push({ id: `uuid-${n.identifier}`, identifier: n.identifier, state: n.state, labels: n.labels, team: "Wolftac Digital" });
    }
  }
  const writes: MockWrite[] = [];
  const authSeen: string[] = [];

  function persistState(identifier: string, state: string) {
    if (!opts.persist || !opts.fixture) return;
    const data = JSON.parse(readFileSync(opts.fixture, "utf8"));
    const n = data.issues.find((x: any) => x.identifier === identifier);
    if (n) n.state = state;
    writeFileSync(opts.fixture, JSON.stringify(data, null, 2) + "\n");
  }

  async function fetchHandler(req: Request): Promise<Response> {
    const ok = (data: unknown) => Response.json({ data });
    if (req.method === "GET") return Response.json({ writes });
    authSeen.push(req.headers.get("authorization") ?? "");
    const { query, variables } = (await req.json()) as { query: string; variables: Record<string, any> };
    if (/\bissueUpdate\b/.test(query)) {
      writes.push({ op: "issueUpdate", variables });
      const i = issues.find((x) => x.id === variables.id);
      const s = TEAM_STATES.find((x) => x.id === variables.stateId);
      if (i && s) {
        i.state = s.name;
        persistState(i.identifier, s.name);
      }
      return ok({ issueUpdate: { success: !!(i && s) } });
    }
    if (/\bcommentCreate\b/.test(query)) {
      writes.push({ op: "commentCreate", variables });
      if (opts.failComment) return Response.json({ errors: [{ message: "fixture comment failure" }] });
      return ok({ commentCreate: { success: true } });
    }
    if (/\bissue\(id:/.test(query)) {
      const i = issues.find((x) => x.identifier === variables.id);
      if (!i) return Response.json({ errors: [{ message: "Entity not found: Issue" }] });
      return ok({
        issue: {
          id: i.id, identifier: i.identifier, state: { name: i.state },
          labels: { nodes: i.labels.map((name) => ({ name })) },
          team: { name: i.team, states: { nodes: TEAM_STATES } },
        },
      });
    }
    return Response.json({ errors: [{ message: "mock: unsupported query" }] });
  }

  return { fetch: fetchHandler, writes, issues, authSeen };
}
