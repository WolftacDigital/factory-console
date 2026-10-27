// Fixture mode only: "@now", "@now-10m", "@now+2h", "@now-3d" strings resolve to ISO times at read time,
// so the shipped fixtures stay inside the 90-minute / 24-hour / 7-day windows on any day.
// Anchored at process start so snapshots stay byte-stable between polls (updates only on real edits).
export const FIXTURE_ANCHOR = Date.now();
const RE = /^@now(?:([+-])(\d+)([smhd]))?$/;
const UNIT: Record<string, number> = { s: 1e3, m: 6e4, h: 36e5, d: 864e5 };

export function resolveFixtureTimes<T>(value: T, now = FIXTURE_ANCHOR): T {
  if (typeof value === "string") {
    const m = value.match(RE);
    if (!m) return value;
    const delta = m[1] ? (m[1] === "-" ? -1 : 1) * Number(m[2]) * UNIT[m[3]] : 0;
    return new Date(now + delta).toISOString() as T;
  }
  if (Array.isArray(value)) return value.map((v) => resolveFixtureTimes(v, now)) as T;
  if (value && typeof value === "object") {
    const out: any = {};
    for (const [k, v] of Object.entries(value)) out[k] = resolveFixtureTimes(v, now);
    return out;
  }
  return value;
}
