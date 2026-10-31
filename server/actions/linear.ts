// Requeue: the only Linear write in the console. It moves one eligible issue to the team's Todo state and comments why.
import { redact } from "../redact";
import { LINEAR_URL, OPEN_STATES, QUEUE_LABEL, TEAM_NAME } from "../sources/linear";

export const TARGET_STATE = "Todo";
/** Open conveyor states other than the target. Nothing else may be requeued. */
export const REQUEUE_FROM_STATES: readonly string[] = OPEN_STATES.filter((s) => s !== TARGET_STATE);
export const MIN_REASON = 10;
export const MAX_REASON = 1000;
export const IDENTIFIER_RE = /^[A-Za-z][A-Za-z0-9]*-\d+$/;

export const ISSUE_QUERY = `query RequeueIssue($id: String!) {
  issue(id: $id) {
    id identifier state { name } labels { nodes { name } }
    team { name states { nodes { id name } } }
  }
}`;
export const STATE_MUTATION = `mutation RequeueState($id: String!, $stateId: String!) {
  issueUpdate(id: $id, input: { stateId: $stateId }) { success }
}`;
export const COMMENT_MUTATION = `mutation RequeueComment($issueId: String!, $body: String!) {
  commentCreate(input: { issueId: $issueId, body: $body }) { success }
}`;

export const commentBody = (reason: string) => `Requeued from Factory Console by Jonathan: ${redact(reason)}`;

export interface LinearConfig { apiKey: string; url?: string; fetchImpl?: typeof fetch }
export interface IssueFacts {
  id: string; state: string; labels: string[]; team: string; states: { id: string; name: string }[];
}

export type RequeueOutcome =
  | { kind: "refused"; reason: string }
  | { kind: "failed"; reason: string }
  | { kind: "planned"; from: string; stateId: string; comment: string }
  | { kind: "moved"; from: string }
  | { kind: "partial"; from: string; reason: string };

/** Pure eligibility filter: a refusal reason, or null when the issue may be requeued. */
export function issueRefusal(i: Pick<IssueFacts, "state" | "labels" | "team">): string | null {
  if (i.team !== TEAM_NAME) return `Issue is not in team ${TEAM_NAME}`;
  if (!i.labels.includes(QUEUE_LABEL)) return `Issue does not have the ${QUEUE_LABEL} label`;
  if (!REQUEUE_FROM_STATES.includes(i.state)) return `Issue is in ${i.state}; only ${REQUEUE_FROM_STATES.join(", ")} can be requeued`;
  return null;
}

export function reasonRefusal(reason: unknown): string | null {
  if (typeof reason !== "string" || reason.trim().length < MIN_REASON) return `A reason of at least ${MIN_REASON} characters is required`;
  if (reason.length > MAX_REASON) return `Reason must be ${MAX_REASON} characters or fewer`;
  return null;
}

type Gql = { ok: true; data: any } | { ok: false; reason: string; notFound?: boolean };

async function gql(cfg: LinearConfig, query: string, variables: Record<string, unknown>): Promise<Gql> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 15_000);
  try {
    const res = await (cfg.fetchImpl ?? fetch)(cfg.url ?? LINEAR_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: cfg.apiKey.trim() },
      body: JSON.stringify({ query, variables }),
      signal: ctrl.signal,
    });
    if (res.status === 401 || res.status === 403) return { ok: false, reason: `HTTP ${res.status}: invalid or unauthorized LINEAR_API_KEY` };
    if (!res.ok) return { ok: false, reason: `HTTP ${res.status} from Linear` };
    const body: any = await res.json();
    if (Array.isArray(body?.errors) && body.errors.length) {
      const message = String(body.errors[0]?.message ?? "unknown").slice(0, 200);
      return { ok: false, reason: `Linear error: ${redact(message)}`, notFound: /not found/i.test(message) };
    }
    return { ok: true, data: body?.data };
  } catch (e: any) {
    return { ok: false, reason: `network error: ${e?.name === "AbortError" ? "timeout" : "fetch failed"}` };
  } finally {
    clearTimeout(timer);
  }
}

/** Re-fetches the issue, checks it, then moves it and comments. With dryRun, stops before any write. */
export async function requeueIssue(cfg: LinearConfig, identifier: string, reason: string, opts: { dryRun?: boolean } = {}): Promise<RequeueOutcome> {
  const fetched = await gql(cfg, ISSUE_QUERY, { id: identifier });
  if (!fetched.ok) return fetched.notFound ? { kind: "refused", reason: "Issue not found" } : { kind: "failed", reason: fetched.reason };
  const n = fetched.data?.issue;
  if (!n) return { kind: "refused", reason: "Issue not found" };
  const facts: IssueFacts = {
    id: String(n.id),
    state: String(n.state?.name ?? ""),
    labels: (n.labels?.nodes ?? []).map((l: any) => String(l.name)),
    team: String(n.team?.name ?? ""),
    states: (n.team?.states?.nodes ?? []).map((s: any) => ({ id: String(s.id), name: String(s.name) })),
  };
  const refusal = issueRefusal(facts);
  if (refusal) return { kind: "refused", reason: refusal };
  const target = facts.states.find((s) => s.name === TARGET_STATE);
  if (!target) return { kind: "failed", reason: `Team has no ${TARGET_STATE} state` };
  const comment = commentBody(reason);
  if (opts.dryRun) return { kind: "planned", from: facts.state, stateId: target.id, comment };

  const moved = await gql(cfg, STATE_MUTATION, { id: facts.id, stateId: target.id });
  if (!moved.ok) return { kind: "failed", reason: moved.reason };
  if (!moved.data?.issueUpdate?.success) return { kind: "failed", reason: "Linear did not confirm the state change" };

  // The state has moved. A comment failure is reported, and the state is not rolled back.
  const commented = await gql(cfg, COMMENT_MUTATION, { issueId: facts.id, body: comment });
  if (!commented.ok) return { kind: "partial", from: facts.state, reason: commented.reason };
  if (!commented.data?.commentCreate?.success) return { kind: "partial", from: facts.state, reason: "Linear did not confirm the comment" };
  return { kind: "moved", from: facts.state };
}
