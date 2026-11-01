import { useEffect, useState } from "react";
import { fetchActionLog, onLogChanged } from "../actions";
import type { ActionLogEntry } from "../types";
import { fmtTime } from "../types";

const REFRESH_MS = 15_000;

export function ActionsList({ entries }: { entries: ActionLogEntry[] }) {
  if (!entries.length) return <p className="empty">No actions yet</p>;
  return (
    <ul className="action-list">
      {entries.map((e, i) => (
        <li className={`action-row res-${e.result}`} key={`${e.ts}-${i}`}>
          <span className="action-time">{fmtTime(e.ts)}</span>
          <span className="action-name">{e.action}</span>
          <span className="data">{e.target ?? "—"}</span>
          <span className="action-result">{e.result}</span>
          {(e.error || e.reason) && <span className="action-note">{e.error ?? e.reason}</span>}
          {e.backup && <span className="action-note data">backup: {e.backup}</span>}
        </li>
      ))}
    </ul>
  );
}

export function ActionsPanel() {
  const [entries, setEntries] = useState<ActionLogEntry[]>([]);
  useEffect(() => {
    let live = true;
    const load = () => {
      fetchActionLog(50).then((rows) => {
        if (live) setEntries(rows);
      }).catch(() => {});
    };
    load();
    const off = onLogChanged(load);
    const timer = setInterval(load, REFRESH_MS);
    return () => {
      live = false;
      off();
      clearInterval(timer);
    };
  }, []);
  return (
    <section className="panel" aria-labelledby="actions-h">
      <h2 id="actions-h">ACTIONS <span className="label">last 50</span></h2>
      <ActionsList entries={entries} />
    </section>
  );
}
