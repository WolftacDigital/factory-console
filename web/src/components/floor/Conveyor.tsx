import { useMemo } from "react";
import { BufferGeometry, Float32BufferAttribute } from "three";
import { Label } from "./Label";
import { CONVEYOR_Z, FLOOR_D, FLOOR_W, ZONE_D, ZONE_STEP, ZONE_W, type ZonePlacement } from "./layout";
import { PALETTE } from "./palette";

function segments(points: number[]): BufferGeometry {
  const g = new BufferGeometry();
  g.setAttribute("position", new Float32BufferAttribute(points, 3));
  return g;
}

function ZoneOutline() {
  const g = useMemo(() => {
    const w = ZONE_W / 2, d = ZONE_D / 2, y = 0.03;
    return segments([-w, y, -d, w, y, -d, w, y, -d, w, y, d, w, y, d, -w, y, d, -w, y, d, -w, y, -d]);
  }, []);
  return (
    <lineSegments geometry={g}>
      <lineBasicMaterial color="#3a4640" />
    </lineSegments>
  );
}

interface Props { zones: ZonePlacement[]; message: string | null }

/** Grid floor, the cyan conveyor line, and the five state zones left to right. */
export function Conveyor({ zones, message }: Props) {
  const half = (zones.length * ZONE_STEP) / 2;
  const line = useMemo(() => segments([-half, 0.04, CONVEYOR_Z, half, 0.04, CONVEYOR_Z]), [half]);
  return (
    <>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.01, 0]}>
        <planeGeometry args={[FLOOR_W, FLOOR_D]} />
        <meshBasicMaterial color={PALETTE.panel} />
      </mesh>
      <gridHelper args={[FLOOR_W, FLOOR_W, PALETTE.grid, PALETTE.panel2]} scale={[1, 1, FLOOR_D / FLOOR_W]} />
      <lineSegments geometry={line}>
        <lineBasicMaterial color={PALETTE.cyan} />
      </lineSegments>
      {zones.map((z) => (
        <group key={z.name} position={[z.x, 0, z.z]}>
          <ZoneOutline />
          <group position={[0, 0, ZONE_D / 2 + 0.4]}>
            <Label y={0.05} className="zone">{z.label} <span className="count">{z.total}</span></Label>
          </group>
          {z.total === 0 && (
            <group position={[0, 0, -0.9]}>
              <Label y={0.05} className="zone-empty">—</Label>
            </group>
          )}
        </group>
      ))}
      {message && (
        <group position={[0, 0.2, CONVEYOR_Z]}>
          <Label y={0.6} className="floor-message">{message}</Label>
        </group>
      )}
    </>
  );
}
