import { useEffect, useRef } from "react";
import { fmtTime, type Selection, type Snapshot } from "../types";
import { StatusChip } from "./StatusChip";

interface Props { snap: Snapshot; sel: Selection; onClose: () => void }

export function DetailDrawer({ snap, sel, onClose }: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    closeRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
      } else if (e.key === "Tab" && ref.current) {
        // keep focus inside the dialog
        const f = ref.current.querySelectorAll<HTMLElement>("button, a[href], [tabindex]:not([tabindex='-1']), summary");
        if (!f.length) return;
        const first = f[0], last = f[f.length - 1];
        if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
        else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  let title = "";
  let body: JSX.Element;
  if (sel.kind === "station") {
    const s = snap.stations.find((x) => x.key === sel.key);
    if (!s) return null;
    title = s.name;
    const d = s.detail;
    body = (
      <>
        <StatusChip status={s.status} />
        <dl>
          <dt>Status reason</dt><dd>{s.reason}</dd>
          {s.status === "WORKING" && (
            <>
              <dt>Current issue</dt>
              <dd>
                {s.currentIssue ? (
                  <a href={s.currentIssue.url || undefined} target="_blank" rel="noopener noreferrer">{s.currentIssue.identifier} {s.currentIssue.title}</a>
                ) : (s.currentNote ?? "picking up work")}
              </dd>
            </>
          )}
          <dt>Model / provider</dt><dd className="data">{[s.model, s.provider].filter(Boolean).join(" / ") || "—"}</dd>
          <dt>Profile / job</dt><dd className="data">{s.profile} / {s.jobId}</dd>
          <dt>Schedule</dt><dd className="data">{s.schedule ?? "—"}</dd>
          <dt>Last run</dt><dd>{fmtTime(d.lastRunAt)} · <span className="data">{d.lastStatus ?? "—"}</span></dd>
          <dt>Next run</dt><dd>{fmtTime(d.nextRunAt)}</dd>
          <dt>Failure streak</dt><dd className="data">{d.failureStreak ?? "—"}</dd>
          <dt>Last error</dt><dd>{d.lastError ?? "none"}</dd>
          <dt>Paused reason</dt><dd>{d.pausedReason ?? (s.status === "PAUSED" ? "(no reason given)" : "not paused")}{d.pausedAt ? ` · since ${fmtTime(d.pausedAt)}` : ""}</dd>
        </dl>
        <h3 className="label">Latest run output {d.outputFile ? `· ${d.outputFile}` : ""} (redacted, ≤60 lines)</h3>
        {d.outputExcerpt.length ? <pre tabIndex={0}>{d.outputExcerpt.join("\n")}</pre> : <p className="empty">No run output found</p>}
        {d.gatekeeperLogs && (
          <>
            {d.gatekeeperLogs.map((g) => (
              <div key={g.lane}>
                <h3 className="label">Gatekeeper log · {g.lane} · {g.file}</h3>
                <pre tabIndex={0}>{g.lines.join("\n")}</pre>
              </div>
            ))}
          </>
        )}
      </>
    );
  } else if (sel.kind === "logan") {
    const l = snap.logan;
    title = "Logan";
    body = (
      <>
        <StatusChip status={l.status} />
        <dl>
          <dt>Role</dt><dd>{l.role}</dd>
          <dt>Status reason</dt><dd>{l.reason}</dd>
          <dt>Gateway</dt><dd className="data">{l.gatewayState ?? "—"}</dd>
          <dt>Active agents</dt><dd className="data">{l.activeAgents ?? "—"}</dd>
          <dt>Platforms</dt><dd>{l.platforms.length ? l.platforms.map((p) => `${p.name}: ${p.state}`).join(" · ") : "—"}</dd>
          <dt>Rollback jobs</dt><dd>{l.rollbackJobs.map((r) => `${r.id} (${r.state})`).join(" · ") || "none"}</dd>
        </dl>
      </>
    );
  } else if (sel.kind === "zeus") {
    const z = snap.zeus;
    title = "Zeus";
    body = (
      <>
        <StatusChip status={z.status} />
        <dl>
          <dt>Role</dt><dd>{z.role}</dd>
          <dt>Status</dt><dd>{z.label}</dd>
          <dt>Detail</dt><dd>{z.detail ?? "—"}</dd>
          <dt>Source</dt><dd>{snap.sources.zeus.state}{snap.sources.zeus.reason ? ` · ${snap.sources.zeus.reason}` : ""}</dd>
        </dl>
      </>
    );
  } else if (sel.kind === "spec") {
    title = "Spec";
    body = (
      <>
        <StatusChip status="ON DEMAND" />
        <dl>
          <dt>Runs</dt><dd>Interactive sessions (/wolftac-spec), no schedule</dd>
          <dt>Created last 24h</dt><dd className="data">{snap.spec.createdLast24h ?? "— (Linear not connected)"}</dd>
        </dl>
      </>
    );
  } else {
    title = "Jonathan";
    body = (
      <dl>
        <dt>Role</dt><dd>Owner · approves merges</dd>
      </dl>
    );
  }

  return (
    <>
      <div className="scrim" onClick={onClose} aria-hidden="true" />
      <div className="drawer" ref={ref} role="dialog" aria-modal="true" aria-labelledby="drawer-h">
        <header>
          <h2 id="drawer-h">{title}</h2>
          <button ref={closeRef} type="button" className="close" onClick={onClose}>CLOSE · ESC</button>
        </header>
        {body}
      </div>
    </>
  );
}
