// Pure snapshot -> floor positions. Deterministic: the same snapshot always gives the same layout.
import type { Card, Selection, Snapshot, Status } from "../../types";

export const ZONE_ORDER = ["Todo", "In Progress", "In Review", "Approved", "Done"] as const;
export const MAX_VISIBLE = 12;
export const ZONE_STEP = 5;
export const ZONE_W = 4.5;
export const ZONE_D = 3.6;
export const CONVEYOR_Z = 4;
export const FLOOR_W = 34;
export const FLOOR_D = 20;
const COLS = 4;
const ROWS = 3;
const SLOT = 1;
const STATION_Z = -4.5;
const STATION_SPAN = 22;

/** updatedAt is optional: the snapshot does not carry it today, so ties keep the board's order. */
export type FloorCard = Card & { updatedAt?: string };

export interface UnitPlacement {
  id: string;
  selection: Selection;
  name: string;
  role: string;
  status: Status;
  kind: "station" | "core" | "beacon";
  remote: boolean;
  x: number;
  z: number;
}
export interface ZonePlacement { name: string; label: string; x: number; z: number; total: number }
export interface IssuePlacement {
  identifier: string;
  title: string;
  url: string;
  state: string;
  lane: string;
  /** Scene object that represents it: its own crate, or the zone's overflow stack. */
  objectId: string;
}
export interface CratePlacement extends IssuePlacement { x: number; z: number }
export interface OverflowPlacement { id: string; zone: string; label: string; count: number; identifiers: string[]; x: number; z: number }
export interface BeamPlacement { unitId: string; objectId: string }
export interface FloorLayout {
  units: UnitPlacement[];
  zones: ZonePlacement[];
  crates: CratePlacement[];
  overflows: OverflowPlacement[];
  beams: BeamPlacement[];
  /** Every Factory Queue issue, visible or stacked, in zone order. */
  issues: IssuePlacement[];
  boardAvailable: boolean;
}

const stamp = (c: FloorCard): number => {
  const t = c.updatedAt ? Date.parse(c.updatedAt) : NaN;
  return Number.isNaN(t) ? Number.POSITIVE_INFINITY : t;
};

/** Oldest first. Array.prototype.sort is stable, so equal or missing stamps keep their board order. */
export function orderCards(cards: FloorCard[]): FloorCard[] {
  return [...cards].sort((a, b) => {
    const x = stamp(a), y = stamp(b);
    return x === y ? 0 : x < y ? -1 : 1;
  });
}

export const crateId = (identifier: string) => `crate:${identifier}`;
export const overflowId = (zone: string) => `overflow:${zone}`;

export function slotPosition(zoneX: number, slot: number): { x: number; z: number } {
  const col = slot % COLS;
  const row = Math.floor(slot / COLS) % ROWS;
  return { x: zoneX + (col - (COLS - 1) / 2) * SLOT, z: CONVEYOR_Z + (row - (ROWS - 1) / 2) * SLOT };
}

export function computeLayout(snap: Snapshot): FloorLayout {
  // Spec desk first, at the Todo end, then the stations in snapshot order.
  const row: Omit<UnitPlacement, "x" | "z">[] = [
    { id: "spec", selection: { kind: "spec" }, name: snap.spec.name, role: snap.spec.role, status: snap.spec.status, kind: "station", remote: false },
    ...snap.stations.map((s) => ({ id: `station:${s.key}`, selection: { kind: "station", key: s.key } as Selection, name: s.name, role: s.role, status: s.status, kind: "station" as const, remote: false })),
  ];
  const step = row.length > 1 ? STATION_SPAN / (row.length - 1) : 0;
  const units: UnitPlacement[] = row.map((u, i) => ({ ...u, x: -STATION_SPAN / 2 + i * step, z: STATION_Z }));
  units.push({ id: "logan", selection: { kind: "logan" }, name: snap.logan.name, role: snap.logan.role, status: snap.logan.status, kind: "core", remote: false, x: 0, z: 0 });
  units.push({ id: "zeus", selection: { kind: "zeus" }, name: snap.zeus.name, role: snap.zeus.role, status: snap.zeus.status, kind: "beacon", remote: true, x: FLOOR_W / 2 - 1.5, z: -FLOOR_D / 2 + 1.5 });

  const zones: ZonePlacement[] = [];
  const crates: CratePlacement[] = [];
  const overflows: OverflowPlacement[] = [];
  const issues: IssuePlacement[] = [];
  ZONE_ORDER.forEach((name, i) => {
    const column = snap.board?.columns.find((c) => c.name === name);
    const x = (i - (ZONE_ORDER.length - 1) / 2) * ZONE_STEP;
    const ordered = orderCards(column?.cards ?? []);
    zones.push({ name, label: column?.label ?? name, x, z: CONVEYOR_Z, total: ordered.length });
    const place = (c: FloorCard, objectId: string): IssuePlacement => ({ identifier: c.identifier, title: c.title, url: c.url, state: name, lane: c.lane, objectId });
    ordered.slice(0, MAX_VISIBLE).forEach((c, slot) => {
      const issue = place(c, crateId(c.identifier));
      issues.push(issue);
      crates.push({ ...issue, ...slotPosition(x, slot) });
    });
    const rest = ordered.slice(MAX_VISIBLE);
    if (rest.length) {
      const id = overflowId(name);
      rest.forEach((c) => issues.push(place(c, id)));
      overflows.push({ id, zone: name, label: `+${rest.length}`, count: rest.length, identifiers: rest.map((c) => c.identifier), x: x + 1.5, z: CONVEYOR_Z + ZONE_D / 2 + 1 });
    }
  });

  const beams: BeamPlacement[] = [];
  for (const s of snap.stations) {
    if (s.status !== "WORKING" || !s.currentIssue) continue;
    const issue = issues.find((i) => i.identifier === s.currentIssue!.identifier);
    if (issue) beams.push({ unitId: `station:${s.key}`, objectId: issue.objectId });
  }
  return { units, zones, crates, overflows, beams, issues, boardAvailable: !!snap.board };
}

// Camera pose. Kept here so its validation is pure and tested.
export type Vec3 = [number, number, number];
export interface CameraPose { position: Vec3; target: Vec3 }
export const CAMERA_KEY = "factory-console.floor.camera";
export const MIN_DISTANCE = 8;
export const MAX_DISTANCE = 70;
export const MAX_POLAR = Math.PI / 2 - 0.08; // never at or under the floor
const BASE_POSITION: Vec3 = [0, 15, 19.5];
const BASE_TARGET: Vec3 = [0, 0, 1];

/** Default three-quarter view, pulled back on narrow panels so the whole floor fits. */
export function defaultCamera(aspect: number): CameraPose {
  const k = aspect > 0 ? Math.max(1, 1.8 / aspect) : 1;
  return {
    position: [BASE_POSITION[0], BASE_POSITION[1] * k, BASE_TARGET[2] + (BASE_POSITION[2] - BASE_TARGET[2]) * k],
    target: BASE_TARGET,
  };
}

const isVec = (v: unknown): v is Vec3 => Array.isArray(v) && v.length === 3 && v.every((n) => typeof n === "number" && Number.isFinite(n));

/** Saved pose from localStorage, or null if it is missing, malformed or outside the camera limits. */
export function parseCamera(raw: string | null): CameraPose | null {
  if (!raw) return null;
  try {
    const p = JSON.parse(raw);
    if (!isVec(p?.position) || !isVec(p?.target)) return null;
    const d = [0, 1, 2].map((i) => p.position[i] - p.target[i]);
    const dist = Math.hypot(d[0], d[1], d[2]);
    if (dist < MIN_DISTANCE || dist > MAX_DISTANCE || d[1] <= 0) return null;
    return { position: p.position, target: p.target };
  } catch {
    return null;
  }
}
