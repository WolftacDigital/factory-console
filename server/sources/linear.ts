// Read-only Linear source: GraphQL queries only (no mutations exist in this file).
import { readFileSync } from "node:fs";
import type { IssueLite } from "../status";
import { resolveFixtureTimes } from "../fixtime";

export const LINEAR_URL = "https://api.linear.app/graphql";
export const TEAM_NAME = "Wolftac Digital";
export const QUEUE_LABEL = "Factory Queue";
export const OPEN_STATES = ["Todo", "In Progress", "In Review", "Approved"];
export const BOARD_COLUMNS = ["Todo", "In Progress", "In Review", "Approved", "Done"] as const;

export type LinearResult = { ok: true; issues: IssueLite[] } | { ok: false; reason: string };

const FIELDS = `identifier title url createdAt updatedAt completedAt
  state { name } labels { nodes { name } } project { name } assignee { name } delegate { name }`;

export const ISSUES_QUERY = `query FactoryQueue($filter: IssueFilter!, $after: String) {
  issues(first: 100, after: $after, filter: $filter) {
    nodes { ${FIELDS} }
    pageInfo { hasNextPage endCursor }
  }
}`;

export function buildFilter(now: number) {
  const since = new Date(now - 7 * 24 * 3600 * 1000).toISOString();
  return {
    team: { name: { eq: TEAM_NAME } },
    labels: { name: { eq: QUEUE_LABEL } },
    or: [
      { state: { name: { in: OPEN_STATES } } },
      { and: [{ state: { name: { eq: "Done" } } }, { completedAt: { gt: since } }] },
    ],
  };
}

export function mapIssue(n: any): IssueLite {
  return {
    identifier: String(n.identifier),
    title: String(n.title ?? ""),
    url: String(n.url ?? ""),
    state: String(n.state?.name ?? ""),
    labels: (n.labels?.nodes ?? []).map((l: any) => String(l.name)),
    project: n.project?.name ?? null,
    assignee: n.assignee?.name ?? null,
    delegate: n.delegate?.name ?? null,
    createdAt: String(n.createdAt ?? ""),
    updatedAt: String(n.updatedAt ?? ""),
    completedAt: n.completedAt ?? null,
  };
}

/** Fetch every Factory Queue issue for the board, following pagination to the end. */
export async function fetchLinearIssues(apiKey: string | undefined, fetchImpl: typeof fetch = fetch, now = Date.now()): Promise<LinearResult> {
  if (!apiKey || !apiKey.trim()) return { ok: false, reason: "LINEAR_API_KEY not set" };
  const issues: IssueLite[] = [];
  let after: string | null = null;
  for (let page = 0; page < 50; page++) {
    let res: Response;
    const ctrl = new AbortController();
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      ctrl.abort();
    }, 15_000);
    try {
      res = await fetchImpl(LINEAR_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: apiKey.trim() },
        body: JSON.stringify({ query: ISSUES_QUERY, variables: { filter: buildFilter(now), after } }),
        signal: ctrl.signal,
      });
    } catch (e: any) {
      return { ok: false, reason: `network error: ${timedOut ? "timeout" : e?.message ?? "fetch failed"}` };
    } finally {
      clearTimeout(timer);
    }
    if (res.status === 401 || res.status === 403) return { ok: false, reason: `HTTP ${res.status}: invalid or unauthorized LINEAR_API_KEY` };
    if (!res.ok) return { ok: false, reason: `HTTP ${res.status} from Linear` };
    let body: any;
    try {
      body = await res.json();
    } catch {
      return { ok: false, reason: "invalid JSON from Linear" };
    }
    if (Array.isArray(body?.errors) && body.errors.length) {
      const code = body.errors[0]?.extensions?.code;
      return { ok: false, reason: code === "AUTHENTICATION_ERROR" ? "invalid LINEAR_API_KEY (authentication error)" : `Linear GraphQL error: ${String(body.errors[0]?.message ?? "unknown").slice(0, 120)}` };
    }
    const conn = body?.data?.issues;
    if (!conn || !Array.isArray(conn.nodes)) return { ok: false, reason: "unexpected Linear response shape" };
    for (const n of conn.nodes) issues.push(mapIssue(n));
    if (!conn.pageInfo?.hasNextPage) return { ok: true, issues };
    after = conn.pageInfo.endCursor ?? null;
    if (!after) return { ok: true, issues };
  }
  return { ok: true, issues };
}

/** Fixture mode: <fixtures>/linear.json = { "issues": [ ...raw Linear nodes or IssueLite... ] }. */
export function readLinearFixture(path: string): LinearResult {
  try {
    const raw = resolveFixtureTimes(JSON.parse(readFileSync(path, "utf8")));
    const list = Array.isArray(raw?.issues) ? raw.issues : [];
    return {
      ok: true,
      issues: list.map((n: any) =>
        typeof n.state === "string" ? { ...mapIssue({ ...n, state: { name: n.state }, labels: { nodes: (n.labels ?? []).map((name: string) => ({ name })) }, project: n.project ? { name: n.project } : null, assignee: n.assignee ? { name: n.assignee } : null, delegate: n.delegate ? { name: n.delegate } : null }) } : mapIssue(n),
      ),
    };
  } catch (e: any) {
    return { ok: false, reason: e?.code === "ENOENT" ? "fixture linear.json missing" : "fixture linear.json invalid" };
  }
}

/** Done issues older than 7 days are dropped even if returned. */
export function boardColumns(issues: IssueLite[], now: number): Record<string, IssueLite[]> {
  const cols: Record<string, IssueLite[]> = Object.fromEntries(BOARD_COLUMNS.map((c) => [c, []]));
  const cutoff = now - 7 * 24 * 3600 * 1000;
  for (const i of issues) {
    if (i.state === "Done") {
      if (!i.completedAt || Date.parse(i.completedAt) < cutoff) continue;
    }
    if (cols[i.state]) cols[i.state].push(i);
  }
  for (const c of BOARD_COLUMNS) cols[c].sort((a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt));
  return cols;
}
