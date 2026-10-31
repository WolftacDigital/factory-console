import { useCallback, useEffect, useRef, useState } from "react";
import { DetailDrawer } from "./components/DetailDrawer";
import { FloorSlot } from "./components/FloorSlot";
import { OrgChart } from "./components/OrgChart";
import { QueueBoard } from "./components/QueueBoard";
import type { Selection, Snapshot, SourceState } from "./types";

function Source({ name, s }: { name: string; s: SourceState }) {
  const label = s.state === "connected" ? "connected" : s.state === "unconfigured" ? "not configured" : s.state === "degraded" ? "degraded" : "not connected";
  return (
    <span className={`source ${s.state}`}>
      <span className="dot" aria-hidden="true" />
      {name} {label}
      {s.reason ? <span className="why"> · {s.reason}</span> : null}
    </span>
  );
}

function summarize(prev: Snapshot | null, next: Snapshot): string {
  if (!prev) return "Factory status loaded";
  const changed = next.stations.filter((s) => prev.stations.find((p) => p.key === s.key)?.status !== s.status).map((s) => `${s.name} ${s.status}`);
  return changed.length ? `Updated: ${changed.join(", ")}` : "Factory status updated";
}

export function App() {
  const [snap, setSnap] = useState<Snapshot | null>(null);
  const [connected, setConnected] = useState(false);
  const [everConnected, setEverConnected] = useState(false);
  const [sel, setSel] = useState<Selection | null>(null);
  const [announce, setAnnounce] = useState("");
  const opener = useRef<HTMLElement | null>(null);
  const prevSnap = useRef<Snapshot | null>(null);

  useEffect(() => {
    let es: EventSource | null = null;
    let retry = 1000;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let stopped = false;
    const connect = () => {
      es = new EventSource("/api/stream");
      es.addEventListener("open", () => {
        retry = 1000;
        setConnected(true);
        setEverConnected(true);
      });
      es.addEventListener("snapshot", (ev) => {
        try {
          const next = JSON.parse((ev as MessageEvent).data) as Snapshot | null;
          if (!next) return;
          setAnnounce(summarize(prevSnap.current, next));
          prevSnap.current = next;
          setSnap(next);
        } catch {}
      });
      es.addEventListener("error", () => {
        setConnected(false);
        es?.close();
        if (stopped) return;
        timer = setTimeout(connect, retry);
        retry = Math.min(retry * 2, 30_000); // exponential backoff
      });
    };
    connect();
    return () => {
      stopped = true;
      clearTimeout(timer);
      es?.close();
    };
  }, []);

  const open = useCallback((s: Selection, el: HTMLElement) => {
    opener.current = el;
    setSel(s);
  }, []);
  const close = useCallback(() => {
    setSel(null);
    const el = opener.current;
    setTimeout(() => el?.focus(), 0); // return focus to the node that opened the drawer
  }, []);

  return (
    <div className="app">
      <header className="header">
        <picture>
          <source srcSet="/horizontal-black.svg" media="(prefers-color-scheme: light)" />
          <img className="logo" src="/horizontal-white.svg" alt="Wolftac Digital" />
        </picture>
        <h1>WOLFTAC FACTORY <span className="live">// LIVE</span></h1>
        <span className="label">last update <span className="data">{snap ? new Date(snap.updatedAt).toLocaleTimeString() : "—"}</span>{snap?.mode === "fixtures" ? " · FIXTURES" : ""}</span>
        {snap && (
          <div className="sources" aria-label="Source connections">
            <Source name="Hermes" s={snap.sources.hermes} />
            <Source name="Linear" s={snap.sources.linear} />
            <Source name="Zeus" s={snap.sources.zeus} />
          </div>
        )}
        {!connected && <div className="reconnect" role="status">{everConnected ? "Reconnecting…" : "Connecting…"}</div>}
        {snap && snap.warnings.length > 0 && (
          <div className="warnings" role="alert">
            {snap.warnings.map((w) => <div className="warning" key={w}><strong>WARNING</strong> {w}</div>)}
          </div>
        )}
      </header>
      <div className="sr-only" aria-live="polite" aria-atomic="true">{announce}</div>
      {snap ? (
        <main className="layout">
          <OrgChart snap={snap} onOpen={open} />
          <QueueBoard snap={snap} />
          <FloorSlot />
        </main>
      ) : (
        <p className="empty">Waiting for the first snapshot…</p>
      )}
      <footer className="footer">Read-only · 127.0.0.1 only · no control actions</footer>
      {snap && sel && <DetailDrawer snap={snap} sel={sel} onClose={close} />}
    </div>
  );
}
