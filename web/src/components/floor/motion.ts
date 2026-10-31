// Pure motion curves for the floor. Reduced motion skips all of these.
export const GLIDE_MS = 1500;
export const PULSE_S = 2;
export const BREATHE_S = 6;

export const easeInOut = (t: number): number => {
  const x = Math.min(1, Math.max(0, t));
  return x < 0.5 ? 2 * x * x : 1 - Math.pow(-2 * x + 2, 2) / 2;
};

/** 0..1 sine with the given period. */
export const wave = (seconds: number, period: number): number => 0.5 + 0.5 * Math.sin((2 * Math.PI * seconds) / period);

/** Emissive multiplier for a unit at a moment in time. */
export function emissiveScale(motion: "pulse" | "breathe" | "none", seconds: number, reduced: boolean): number {
  if (reduced || motion === "none") return 1;
  return motion === "pulse" ? 0.4 + 0.6 * wave(seconds, PULSE_S) : 0.7 + 0.3 * wave(seconds, BREATHE_S);
}

export type FrameMode = "fast" | "slow" | "none";

/** How often the floor needs a frame. Render-on-demand: no animation means no frames. */
export function frameMode(motions: ("pulse" | "breathe" | "none")[], reduced: boolean): FrameMode {
  if (reduced) return "none";
  if (motions.includes("pulse")) return "fast";
  return motions.includes("breathe") ? "slow" : "none";
}
