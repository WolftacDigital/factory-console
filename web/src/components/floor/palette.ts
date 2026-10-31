// Wolftac v4 palette for the 3D floor, from the same tokens as web/src/theme.css. The floor is always dark.
import type { Status } from "../../types";

export const PALETTE = {
  bg: "#050706",
  panel: "#0a0d0b",
  panel2: "#121815",
  grid: "#1e2622",
  graphite: "#2a322e",
  slate: "#94a3b8",
  amber: "#ff5e00",
  cyan: "#00f0ff", // data labels and the conveyor line only
  red: "#ff003c",
} as const;

export interface UnitLook {
  fill: string;
  edge: string;
  emissive: string;
  emissiveIntensity: number;
  haloOpacity: number;
  motion: "pulse" | "breathe" | "none";
  outlineOnly: boolean;
  glyph: string; // state is never color-only
}

const LOOKS: Record<Status, UnitLook> = {
  WORKING: { fill: "#6b2700", edge: PALETTE.amber, emissive: PALETTE.amber, emissiveIntensity: 1, haloOpacity: 0.7, motion: "pulse", outlineOnly: false, glyph: "►" },
  IDLE: { fill: PALETTE.graphite, edge: "#46524c", emissive: PALETTE.slate, emissiveIntensity: 0.18, haloOpacity: 0.08, motion: "breathe", outlineOnly: false, glyph: "–" },
  PAUSED: { fill: PALETTE.slate, edge: PALETTE.slate, emissive: "#000000", emissiveIntensity: 0, haloOpacity: 0, motion: "none", outlineOnly: false, glyph: "||" },
  ERROR: { fill: "#6b0019", edge: PALETTE.red, emissive: PALETTE.red, emissiveIntensity: 1, haloOpacity: 0.55, motion: "none", outlineOnly: false, glyph: "!" },
  UNKNOWN: { fill: PALETTE.bg, edge: PALETTE.slate, emissive: "#000000", emissiveIntensity: 0, haloOpacity: 0, motion: "none", outlineOnly: true, glyph: "?" },
  "ON DEMAND": { fill: PALETTE.panel2, edge: PALETTE.slate, emissive: "#000000", emissiveIntensity: 0, haloOpacity: 0, motion: "none", outlineOnly: false, glyph: "◇" },
};

export const unitLook = (status: Status): UnitLook => LOOKS[status] ?? LOOKS.UNKNOWN;
