import { Html } from "@react-three/drei";
import type { ReactNode } from "react";

// DOM label pinned to a 3D point: uses the page's JetBrains Mono, no font fetched at runtime.
// zIndexRange stays below the drawer and card; labels never take pointer events.
// drei's `pointerEvents` prop only applies in `transform` mode, so the wrapper style carries it;
// otherwise a hover label (for example a crate's title) covers the crate and swallows its click.
const NO_POINTER = { pointerEvents: "none" } as const;

export function Label({ y, className, children }: { y: number; className?: string; children: ReactNode }) {
  return (
    <Html position={[0, y, 0]} center zIndexRange={[4, 0]} pointerEvents="none" style={NO_POINTER}>
      <div className={`floor-label ${className ?? ""}`}>{children}</div>
    </Html>
  );
}
