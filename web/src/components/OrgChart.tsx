import type { Selection, Snapshot, StationView } from "../types";
import { StatusChip } from "./StatusChip";

interface Props { snap: Snapshot; onOpen: (sel: Selection, el: HTMLElement) => void }

function StationNode({ s, onOpen }: { s: StationView; onOpen: Props["onOpen"] }) {
  const model = [s.model, s.provider].filter(Boolean).join(" / ") || "no model (script)";
  return (
    <div className={`node station-node st-${s.status.replace(" ", "_")}`}>
      <button type="button" className="station-details" onClick={(e) => onOpen({ kind: "station", key: s.key }, e.currentTarget)} aria-label={`${s.name}, ${s.status}. Open details`}>
      <span className="name">{s.name}</span>
      <span className="role">{s.role}</span>
      <span className="meta"><span className="data">{model}</span></span>
      <span className="meta">schedule: <span className="data">{s.schedule ?? "—"}</span></span>
      <StatusChip status={s.status} />
      </button>
      {s.status === "WORKING" && s.currentIssue && (
        <a className="issue" href={s.currentIssue.url} target="_blank" rel="noreferrer"><span className="mono">{s.currentIssue.identifier}</span> {s.currentIssue.title}</a>
      )}
      {s.status === "WORKING" && !s.currentIssue && s.currentNote && <span className="reason">{s.currentNote}</span>}
      {s.status === "UNKNOWN" && <span className="reason">{s.reason}</span>}
    </div>
  );
}

export function OrgChart({ snap, onOpen }: Props) {
  const { owner, logan, zeus, spec } = snap;
  return (
    <section className="panel primary" aria-labelledby="org-h">
      <h2 id="org-h">ORG CHART <span className="label">who is working</span></h2>
      <div className="org">
        <div className="org-row top">
          <button type="button" className="node" onClick={(e) => onOpen({ kind: "owner" }, e.currentTarget)} aria-label="Jonathan, Owner. Open details">
            <span className="name">{owner.name}</span>
            <span className="role">{owner.role}</span>
          </button>
        </div>
        <div className="org-branch" aria-hidden="true" />
        <div className="org-row mid">
          <div style={{ display: "grid", gap: 6 }}>
            <button type="button" className={`node st-${logan.status}`} onClick={(e) => onOpen({ kind: "logan" }, e.currentTarget)} aria-label={`Logan, ${logan.status}. Open details`}>
              <span className="name">{logan.name}</span>
              <span className="role">{logan.role}</span>
              <span className="meta">gateway: <span className="data">{logan.gatewayState ?? "—"}</span> · agents: <span className="data">{logan.activeAgents ?? "—"}</span></span>
              <StatusChip status={logan.status} />
              {logan.status === "UNKNOWN" && <span className="reason">{logan.reason}</span>}
            </button>
            <details className="rollback">
              <summary>Rollback jobs (paused) · {logan.rollbackJobs.length}</summary>
              <ul>
                {logan.rollbackJobs.map((r) => (
                  <li key={r.id}><span className="mono">{r.id}</span> {r.name} — {r.state}</li>
                ))}
              </ul>
            </details>
          </div>
          <button type="button" className={`node st-${zeus.status}`} onClick={(e) => onOpen({ kind: "zeus" }, e.currentTarget)} aria-label={`Zeus, ${zeus.status}. Open details`}>
            <span className="name">{zeus.name}</span>
            <span className="role">{zeus.role}</span>
            <StatusChip status={zeus.status} />
            <span className="reason">{zeus.label}</span>
          </button>
        </div>
        <div className="org-row workers" role="list" aria-label="Logan's workers">
          <div role="listitem" style={{ display: "grid" }}>
            <button type="button" className="node" onClick={(e) => onOpen({ kind: "spec" }, e.currentTarget)} aria-label="Spec, on demand. Open details">
              <span className="name">{spec.name}</span>
              <span className="role">{spec.role}</span>
              <StatusChip status={spec.status} />
              <span className="meta">created last 24h: <span className="data">{spec.createdLast24h ?? "—"}</span></span>
            </button>
          </div>
          {snap.stations.map((s) => (
            <div role="listitem" key={s.key} style={{ display: "grid" }}>
              <StationNode s={s} onOpen={onOpen} />
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
