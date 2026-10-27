// Client view of the server snapshot (mirrors server/snapshot.ts).
export type Status = "WORKING" | "IDLE" | "PAUSED" | "ERROR" | "UNKNOWN" | "ON DEMAND";
export interface SourceState { state: "connected" | "disconnected" | "degraded" | "unconfigured"; reason: string | null }
export interface IssueRef { identifier: string; title: string; url: string }
export interface Card extends IssueRef { lane: string; assignee: string | null; delegate: string | null; project: string | null }
export interface StationView {
  key: string; name: string; role: string; profile: string; jobId: string;
  model: string | null; provider: string | null; schedule: string | null; skills: string[];
  status: Status; reason: string; currentIssue: IssueRef | null; currentNote: string | null;
  detail: {
    lastRunAt: string | null; lastStatus: string | null; nextRunAt: string | null; failureStreak: number | null;
    lastError: string | null; pausedReason: string | null; pausedAt: string | null;
    outputFile: string | null; outputExcerpt: string[];
    gatekeeperLogs?: { lane: string; file: string; lines: string[] }[];
  };
}
export interface Snapshot {
  updatedAt: string;
  mode: "live" | "fixtures";
  sources: { hermes: SourceState; linear: SourceState; zeus: SourceState };
  warnings: string[];
  owner: { name: string; role: string };
  logan: {
    name: string; role: string; status: Status; reason: string; gatewayState: string | null; activeAgents: number | null;
    platforms: { name: string; state: string }[]; rollbackJobs: { id: string; name: string; state: string; pausedAt: string | null }[];
  };
  zeus: { name: string; role: string; status: Status; label: string; detail: string | null };
  spec: { name: string; role: string; status: Status; createdLast24h: number | null };
  stations: StationView[];
  board: { columns: { name: string; label: string; cards: Card[] }[] } | null;
}

/** Things the drawer can show: a station, or one of the people nodes. */
export type Selection = { kind: "station"; key: string } | { kind: "logan" } | { kind: "zeus" } | { kind: "spec" } | { kind: "owner" };

export const fmtTime = (s: string | null | undefined) => {
  if (!s) return "—";
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? s : d.toLocaleString();
};
