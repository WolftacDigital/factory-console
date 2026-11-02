import { Canvas, useThree } from "@react-three/fiber";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { Vector3 } from "three";
import type { Selection, Snapshot } from "../../types";
import { CameraRig } from "./CameraRig";
import { Conveyor } from "./Conveyor";
import { Beam, Crate } from "./Crate";
import { computeLayout, crateId, overflowStarts, type FloorLayout, type IssuePlacement, type UnitPlacement } from "./layout";
import { frameMode, type FrameMode } from "./motion";
import { PALETTE, unitLook } from "./palette";
import { Station } from "./Station";

interface Props {
  snap: Snapshot;
  connected: boolean;
  onOpen: (sel: Selection, el: HTMLElement) => void;
}

const CAMERA = { fov: 42, near: 0.5, far: 200, position: [0, 15, 19.5] as [number, number, number] };
const DPR: [number, number] = [1, 1.5];
const FRAME_MS: Record<Exclude<FrameMode, "none">, number> = { fast: 33, slow: 125 };

function useReducedMotion(): boolean {
  const [reduced, setReduced] = useState(() => window.matchMedia("(prefers-reduced-motion: reduce)").matches);
  useEffect(() => {
    const m = window.matchMedia("(prefers-reduced-motion: reduce)");
    const on = () => setReduced(m.matches);
    m.addEventListener("change", on);
    return () => m.removeEventListener("change", on);
  }, []);
  return reduced;
}

function useTabHidden(): boolean {
  const [hidden, setHidden] = useState(() => document.hidden);
  useEffect(() => {
    const on = () => setHidden(document.hidden);
    document.addEventListener("visibilitychange", on);
    return () => document.removeEventListener("visibilitychange", on);
  }, []);
  return hidden;
}

/** Requests frames only while a unit animates. Crate glides and the camera request their own. */
function FrameDriver({ mode, hidden }: { mode: FrameMode; hidden: boolean }) {
  const invalidate = useThree((s) => s.invalidate);
  useEffect(() => {
    if (hidden) return;
    invalidate();
    if (mode === "none") return;
    const t = setInterval(() => invalidate(), FRAME_MS[mode]);
    return () => clearInterval(t);
  }, [mode, hidden, invalidate]);
  return null;
}

type CardView = { kind: "issue"; identifier: string } | { kind: "stack"; id: string };

function CardHeader({ title, onClose }: { title: string; onClose: () => void }) {
  return (
    <header>
      <h3 id="floor-card-h">{title}</h3>
      <button type="button" className="close" onClick={onClose} data-floor-card-close>CLOSE · ESC</button>
    </header>
  );
}

function IssueCard({ issue, onClose }: { issue: IssuePlacement; onClose: () => void }) {
  return (
    <>
      <CardHeader title={issue.identifier} onClose={onClose} />
      <p className="title">{issue.title}</p>
      <dl>
        <dt>State</dt><dd>{issue.state}</dd>
        <dt>Lane</dt><dd>{issue.lane}</dd>
      </dl>
      {issue.url ? <a href={issue.url} target="_blank" rel="noopener noreferrer">Open in Linear</a> : <p className="empty">No Linear link</p>}
    </>
  );
}

export function Floor({ snap, connected, onOpen }: Props) {
  const layout = useMemo(() => computeLayout(snap), [snap]);
  // Commit history, not render history: unrelated renders must not erase mount origins.
  const previous = useRef<FloorLayout | null>(null);
  const starts = useMemo(() => overflowStarts(previous.current, layout), [layout]);
  useLayoutEffect(() => { previous.current = layout; }, [layout]);
  const reduced = useReducedMotion();
  const hidden = useTabHidden();
  const [hover, setHover] = useState<string | null>(null);
  const [card, setCard] = useState<CardView | null>(null);
  const [resetCount, setResetCount] = useState(0);
  const [lost, setLost] = useState(false);
  const positions = useRef(new Map<string, Vector3>());
  const mirror = useRef<HTMLUListElement>(null);
  const cardEl = useRef<HTMLDivElement>(null);
  const opener = useRef<HTMLElement | null>(null);

  const mode = useMemo(() => frameMode(layout.units.map((u) => unitLook(u.status).motion), reduced), [layout, reduced]);
  const mirrorButton = useCallback((id: string) => mirror.current?.querySelector<HTMLElement>(`[data-floor-id="${CSS.escape(id)}"]`) ?? null, []);

  const openUnit = useCallback((u: UnitPlacement) => {
    const el = mirrorButton(u.id);
    if (el) onOpen(u.selection, el);
  }, [mirrorButton, onOpen]);

  const openCard = useCallback((view: CardView, el: HTMLElement | null) => {
    opener.current = el;
    setCard(view);
  }, []);

  const closeCard = useCallback(() => {
    setCard(null);
    const el = opener.current;
    setTimeout(() => el?.focus(), 0);
  }, []);

  useEffect(() => {
    if (!card) return;
    cardEl.current?.querySelector<HTMLElement>("[data-floor-card-close]")?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || document.querySelector(".drawer")) return;
      e.preventDefault();
      closeCard();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [card, closeCard]);

  // A lost GL context falls through to the panel's error boundary fallback.
  if (lost) throw new Error("WebGL context lost");

  const shownIssue = card?.kind === "issue" ? layout.issues.find((i) => i.identifier === card.identifier) : undefined;
  const shownStack = card?.kind === "stack" ? layout.overflows.find((o) => o.id === card.id) : undefined;
  const stackIssues = shownStack ? layout.issues.filter((i) => i.objectId === shownStack.id) : [];
  const message = !layout.boardAvailable ? "Linear not connected" : layout.issues.length === 0 ? "Queue empty" : null;

  return (
    <div className={`floor-stage${connected ? "" : " disconnected"}${hover ? " hovering" : ""}`}>
      <Canvas
        flat
        frameloop={hidden ? "never" : "demand"}
        dpr={DPR}
        camera={CAMERA}
        onCreated={({ gl }) => {
          gl.setClearColor(PALETTE.bg);
          gl.domElement.addEventListener("webglcontextlost", () => setLost(true));
        }}
      >
        <ambientLight intensity={0.9} />
        <directionalLight position={[8, 20, 12]} intensity={1.4} />
        <FrameDriver mode={mode} hidden={hidden} />
        <Conveyor zones={layout.zones} message={message} />
        {layout.units.map((u) => (
          <Station key={u.id} unit={u} reduced={reduced} hovered={hover === u.id} onHover={setHover} onSelect={openUnit} />
        ))}
        {layout.crates.map((c) => (
          <Crate
            key={c.identifier}
            id={crateId(c.identifier)}
            x={c.x}
            z={c.z}
            initialPosition={starts.get(c.identifier)}
            label={c.identifier}
            title={c.title}
            reduced={reduced}
            hovered={hover === crateId(c.identifier)}
            positions={positions}
            onHover={setHover}
            onSelect={() => openCard({ kind: "issue", identifier: c.identifier }, mirrorButton(crateId(c.identifier)))}
          />
        ))}
        {layout.overflows.map((o) => (
          <Crate
            key={o.id}
            id={o.id}
            x={o.x}
            z={o.z}
            label={o.label}
            title={`${o.count} more in ${o.zone}`}
            stacked
            reduced={reduced}
            hovered={hover === o.id}
            positions={positions}
            onHover={setHover}
            onSelect={() => openCard({ kind: "stack", id: o.id }, mirrorButton(crateId(o.identifiers[0])))}
          />
        ))}
        {layout.beams.map((b) => {
          const u = layout.units.find((x) => x.id === b.unitId)!;
          return <Beam key={b.unitId} fromX={u.x} fromZ={u.z} objectId={b.objectId} positions={positions} />;
        })}
        <CameraRig resetCount={resetCount} reduced={reduced} />
      </Canvas>

      <button type="button" className="floor-reset" onClick={() => setResetCount((n) => n + 1)}>RESET VIEW</button>
      {!connected && <div className="floor-reconnect" role="status">Reconnecting…</div>}

      <ul ref={mirror} className="floor-mirror" aria-label="3D floor objects">
        {layout.units.map((u) => (
          <li key={u.id}>
            <button
              type="button"
              data-floor-id={u.id}
              onFocus={() => setHover(u.id)}
              onBlur={() => setHover(null)}
              onClick={(e) => onOpen(u.selection, e.currentTarget)}
            >
              {u.name}{u.remote ? " (remote)" : ""}, {u.status}. Open details
            </button>
          </li>
        ))}
        {layout.issues.map((i) => (
          <li key={i.identifier}>
            <button
              type="button"
              data-floor-id={crateId(i.identifier)}
              onFocus={() => setHover(i.objectId)}
              onBlur={() => setHover(null)}
              onClick={(e) => openCard({ kind: "issue", identifier: i.identifier }, e.currentTarget)}
            >
              {i.identifier} {i.title}, {i.state}. Open card
            </button>
          </li>
        ))}
      </ul>

      {(shownIssue || shownStack) && (
        <div className="floor-card" ref={cardEl} role="dialog" aria-labelledby="floor-card-h">
          {shownIssue && <IssueCard issue={shownIssue} onClose={closeCard} />}
          {shownStack && (
            <>
              <CardHeader title={`${shownStack.label} in ${shownStack.zone}`} onClose={closeCard} />
              <ul>
                {stackIssues.map((i) => (
                  <li key={i.identifier}>
                    {i.url ? <a href={i.url} target="_blank" rel="noopener noreferrer">{i.identifier}</a> : i.identifier} {i.title}
                  </li>
                ))}
              </ul>
            </>
          )}
        </div>
      )}
    </div>
  );
}
