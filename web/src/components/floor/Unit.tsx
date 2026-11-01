/// <reference types="vite/client" />
import { useFrame, type ThreeEvent } from "@react-three/fiber";
import { useRef } from "react";
import type { MeshStandardMaterial, SpriteMaterial } from "three";
import { AdditiveBlending, BoxGeometry, CanvasTexture, ConeGeometry, OctahedronGeometry } from "three";
import { Label } from "./Label";
import type { UnitPlacement } from "./layout";
import { emissiveScale } from "./motion";
import { unitLook } from "./palette";

const GEOMETRY = {
  station: new BoxGeometry(1.1, 1.1, 1.1),
  core: new OctahedronGeometry(1.1, 0),
  beacon: new ConeGeometry(0.7, 1.8, 4),
};

let haloTexture: CanvasTexture | null = null;
/** Procedural radial glow, shared by every unit. */
function halo(): CanvasTexture {
  if (haloTexture) return haloTexture;
  const c = document.createElement("canvas");
  c.width = c.height = 64;
  const g = c.getContext("2d")!;
  const r = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  r.addColorStop(0, "rgba(255,255,255,1)");
  r.addColorStop(1, "rgba(255,255,255,0)");
  g.fillStyle = r;
  g.fillRect(0, 0, 64, 64);
  haloTexture = new CanvasTexture(c);
  return haloTexture;
}

export interface UnitProps {
  unit: UnitPlacement;
  reduced: boolean;
  hovered: boolean;
  onHover: (id: string | null) => void;
  onSelect: (u: UnitPlacement) => void;
}

export function Unit({ unit, reduced, hovered, onHover, onSelect }: UnitProps) {
  // Dev-only crash switch for the error boundary test. Stripped from production builds.
  if (import.meta.env.DEV && new URLSearchParams(window.location.search).get("floorCrash") === "1") {
    throw new Error("floorCrash test flag");
  }
  const look = unitLook(unit.status);
  const mat = useRef<MeshStandardMaterial>(null);
  const glow = useRef<SpriteMaterial>(null);
  const y = unit.kind === "core" ? 1.6 : 0.95;
  const geometry = GEOMETRY[unit.kind];
  const scale = hovered ? 1.08 : 1;

  useFrame(() => {
    const k = emissiveScale(look.motion, performance.now() / 1000, reduced);
    if (mat.current) mat.current.emissiveIntensity = look.emissiveIntensity * k;
    if (glow.current) glow.current.opacity = look.haloOpacity * k;
  });

  const over = (e: ThreeEvent<PointerEvent>) => { e.stopPropagation(); onHover(unit.id); };
  const out = () => onHover(null);
  const click = (e: ThreeEvent<MouseEvent>) => {
    e.stopPropagation();
    if (e.delta > 6) return; // that was an orbit drag
    onSelect(unit);
  };

  return (
    <group position={[unit.x, y, unit.z]}>
      <mesh geometry={geometry} onPointerOver={over} onPointerOut={out} onClick={click} scale={scale}>
        {look.outlineOnly ? (
          // Invisible but still hit-testable: UNKNOWN is drawn by its edges only.
          <meshBasicMaterial transparent opacity={0} depthWrite={false} />
        ) : (
          <meshStandardMaterial ref={mat} color={look.fill} emissive={look.emissive} emissiveIntensity={look.emissiveIntensity} flatShading roughness={0.7} />
        )}
      </mesh>
      <lineSegments scale={scale}>
        <edgesGeometry args={[geometry]} />
        <lineBasicMaterial color={hovered ? "#e2e8f0" : look.edge} />
      </lineSegments>
      {look.haloOpacity > 0 && (
        <sprite scale={3.4}>
          <spriteMaterial ref={glow} map={halo()} color={look.emissive} blending={AdditiveBlending} transparent depthWrite={false} opacity={look.haloOpacity} />
        </sprite>
      )}
      <Label y={unit.kind === "core" ? 1.7 : 1.35} className={`unit st-${unit.status.replace(" ", "_")}`}>
        <span><span className="glyph" aria-hidden="true">{look.glyph}</span> {unit.name}</span>
        {unit.remote && <span className="remote">REMOTE</span>}
        <span className="state">{unit.status}</span>
        {hovered && <span className="more">{unit.role}</span>}
      </Label>
    </group>
  );
}
