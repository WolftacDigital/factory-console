import { Html } from "@react-three/drei";
import type { ReactNode } from "react";

// DOM label pinned to a 3D point: uses the page's JetBrains Mono, no font fetched at runtime.
// zIndexRange stays below the drawer and card; labels never take pointer events.
export function Label({ y, className, children }: { y: number; className?: string; children: ReactNode }) {
  return (
    <Html position={[0, y, 0]} center zIndexRange={[4, 0]} pointerEvents="none">
      <div className={`floor-label ${className ?? ""}`}>{children}</div>
    </Html>
  );
}
