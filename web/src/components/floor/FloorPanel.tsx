import { Component, lazy, Suspense, useState, type ReactNode } from "react";
import type { Selection, Snapshot } from "../../types";
import "./floor.css";

// three.js and the scene live in their own chunk, so the 2D views render before it arrives.
const Floor = lazy(() => import("./Floor").then((m) => ({ default: m.Floor })));

const UNAVAILABLE = "3D floor unavailable on this device";

function hasWebGL(): boolean {
  try {
    // three r163+ renders through WebGL2 only.
    const gl = document.createElement("canvas").getContext("webgl2");
    gl?.getExtension("WEBGL_lose_context")?.loseContext();
    return !!gl;
  } catch {
    return false;
  }
}

/** A floor failure shows the fallback and never takes down the 2D views. */
class FloorBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  componentDidCatch(e: unknown) {
    console.error("3D floor failed", e);
  }
  render() {
    return this.state.failed ? <p className="empty" role="status">{UNAVAILABLE}</p> : this.props.children;
  }
}

interface Props {
  snap: Snapshot;
  connected: boolean;
  onOpen: (sel: Selection, el: HTMLElement) => void;
}

export function FloorPanel(props: Props) {
  const [webgl] = useState(hasWebGL);
  return (
    <section className="panel floor" aria-labelledby="floor-h">
      <h2 id="floor-h">FLOOR // 3D</h2>
      {webgl ? (
        <FloorBoundary>
          <Suspense fallback={<p className="empty">Loading 3D floor…</p>}>
            <Floor {...props} />
          </Suspense>
        </FloorBoundary>
      ) : (
        <p className="empty" role="status">{UNAVAILABLE}</p>
      )}
    </section>
  );
}
