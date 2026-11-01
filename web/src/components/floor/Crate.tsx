import { useFrame, useThree, type ThreeEvent } from "@react-three/fiber";
import { useEffect, useLayoutEffect, useRef, type MutableRefObject } from "react";
import { BoxGeometry, BufferGeometry, Float32BufferAttribute, Vector3, type Group } from "three";
import { Label } from "./Label";
import { easeInOut, GLIDE_MS } from "./motion";
import { PALETTE } from "./palette";

export type Positions = MutableRefObject<Map<string, Vector3>>;
const BOX = new BoxGeometry(0.7, 0.55, 0.7);
const CRATE_Y = 0.3;

interface Props {
  id: string;
  x: number;
  z: number;
  label: string;
  title?: string;
  stacked?: boolean;
  reduced: boolean;
  hovered: boolean;
  positions: Positions;
  onHover: (id: string | null) => void;
  onSelect: () => void;
}

/** One issue, or a zone's +N overflow stack. Glides to a new zone over 1.5 s; jumps with reduced motion. */
export function Crate({ id, x, z, label, title, stacked, reduced, hovered, positions, onHover, onSelect }: Props) {
  const group = useRef<Group>(null);
  const glide = useRef<{ from: Vector3; to: Vector3; start: number } | null>(null);
  const invalidate = useThree((s) => s.invalidate);

  // Starts at its target; later target changes are handled by the glide effect below.
  const placed = useRef(false);
  useLayoutEffect(() => {
    const g = group.current!;
    if (!placed.current) {
      g.position.set(x, CRATE_Y, z);
      placed.current = true;
    }
    const map = positions.current;
    map.set(id, g.position);
    return () => { map.delete(id); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, positions]);

  useEffect(() => {
    const g = group.current!;
    const to = new Vector3(x, CRATE_Y, z);
    if (g.position.equals(to)) return;
    if (reduced) {
      glide.current = null;
      g.position.copy(to);
    } else {
      glide.current = { from: g.position.clone(), to, start: performance.now() };
    }
    invalidate();
  }, [x, z, reduced, invalidate]);

  useFrame(() => {
    const m = glide.current;
    if (!m || !group.current) return;
    const t = (performance.now() - m.start) / GLIDE_MS;
    group.current.position.lerpVectors(m.from, m.to, easeInOut(t));
    if (t >= 1) glide.current = null;
    else invalidate();
  });

  const color = stacked ? PALETTE.graphite : PALETTE.panel2;
  const edge = hovered ? "#e2e8f0" : stacked ? PALETTE.slate : "#5b6e64";
  const layers = stacked ? [0, 0.56, 1.12] : [0];
  return (
    <group ref={group}>
      <group
        onPointerOver={(e: ThreeEvent<PointerEvent>) => { e.stopPropagation(); onHover(id); }}
        onPointerOut={() => onHover(null)}
        onClick={(e: ThreeEvent<MouseEvent>) => {
          e.stopPropagation();
          if (e.delta > 6) return; // that was an orbit drag
          onSelect();
        }}
      >
        {layers.map((dy) => (
          <group key={dy} position={[0, dy, 0]}>
            <mesh geometry={BOX}>
              <meshStandardMaterial color={color} flatShading />
            </mesh>
            {/* Decorative edges must not steal adjacent crate hits (line threshold is 1 world unit). */}
            <lineSegments raycast={() => null}>
              <edgesGeometry args={[BOX]} />
              <lineBasicMaterial color={edge} />
            </lineSegments>
          </group>
        ))}
      </group>
      <Label y={0.62 + (stacked ? 1.12 : 0)} className={stacked ? "crate stack" : "crate"}>
        {label}
        {hovered && title && <span className="more">{title}</span>}
      </Label>
    </group>
  );
}

/** Thin amber line from a WORKING unit to its crate. Follows the crate while it glides. */
export function Beam({ fromX, fromZ, objectId, positions }: { fromX: number; fromZ: number; objectId: string; positions: Positions }) {
  const geometry = useRef<BufferGeometry | null>(null);
  if (!geometry.current) {
    geometry.current = new BufferGeometry();
    geometry.current.setAttribute("position", new Float32BufferAttribute([fromX, 1, fromZ, fromX, 1, fromZ], 3));
  }
  useEffect(() => () => geometry.current?.dispose(), []);
  useFrame(() => {
    const at = positions.current.get(objectId);
    const attr = geometry.current!.getAttribute("position");
    if (!at || (attr.getX(1) === at.x && attr.getY(1) === at.y && attr.getZ(1) === at.z)) return;
    attr.setXYZ(0, fromX, 1, fromZ);
    attr.setXYZ(1, at.x, at.y, at.z);
    attr.needsUpdate = true;
  });
  return (
    <lineSegments geometry={geometry.current} frustumCulled={false}>
      <lineBasicMaterial color={PALETTE.amber} />
    </lineSegments>
  );
}
