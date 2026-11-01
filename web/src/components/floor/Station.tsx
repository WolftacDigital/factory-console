import { Unit, type UnitProps } from "./Unit";
import { PALETTE } from "./palette";

/** A low-poly plinth with its worker unit on top. */
export function Station(props: UnitProps) {
  const { unit } = props;
  const w = unit.kind === "core" ? 3 : 2;
  return (
    <>
      <mesh position={[unit.x, 0.1, unit.z]}>
        <boxGeometry args={[w, 0.2, w]} />
        <meshStandardMaterial color={PALETTE.panel2} flatShading />
      </mesh>
      <Unit {...props} />
    </>
  );
}
