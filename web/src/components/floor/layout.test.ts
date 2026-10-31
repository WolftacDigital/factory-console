import { describe, expect, test } from "bun:test";
import { join } from "node:path";
import { buildSnapshot } from "../../../../server/snapshot";
import { readHermes } from "../../../../server/sources/hermes";
import { readLinearFixture } from "../../../../server/sources/linear";
import type { Snapshot, Status } from "../../types";
import { computeLayout, defaultCamera, MAX_VISIBLE, orderCards, overflowId, parseCamera, slotPosition, ZONE_ORDER, type FloorCard } from "./layout";
import { easeInOut, emissiveScale, frameMode } from "./motion";
import { unitLook } from "./palette";

const fixture = join(import.meta.dir, "../../../../fixtures/mixed");
const mixed = (): Snapshot => ({
  ...buildSnapshot(readHermes(fixture, { fixtures: true }), null, readLinearFixture(join(fixture, "linear.json")), { configured: false }, Date.now(), "fixtures"),
  updatedAt: "2026-01-01T00:00:00.000Z",
});
const card = (n: number, updatedAt?: string): FloorCard => ({ identifier: `FX-${n}`, title: `Fixture ${n}`, url: `https://linear.app/fixture/issue/FX-${n}`, lane: "agentic", assignee: null, delegate: null, project: null, updatedAt });
const withColumn = (name: string, cards: FloorCard[]): Snapshot => {
  const s = mixed();
  s.board = { columns: ZONE_ORDER.map((c) => ({ name: c, label: c, cards: c === name ? cards : [] })) };
  return s;
};

describe("computeLayout", () => {
  test("is deterministic: the same snapshot gives the same positions", () => {
    const s = mixed();
    expect(computeLayout(s)).toEqual(computeLayout(JSON.parse(JSON.stringify(s))));
  });

  test("six stations, the Logan core, a REMOTE Zeus beacon, five zones in conveyor order", () => {
    const l = computeLayout(mixed());
    expect(l.units.filter((u) => u.kind === "station").map((u) => u.id)).toEqual(["spec", "station:gatekeeper", "station:build-agentic", "station:build-crm", "station:review", "station:integrate"]);
    expect(l.units.find((u) => u.id === "logan")?.kind).toBe("core");
    const zeus = l.units.find((u) => u.id === "zeus")!;
    expect(zeus.kind).toBe("beacon");
    expect(zeus.remote).toBe(true);
    expect(l.zones.map((z) => z.name)).toEqual(["Todo", "In Progress", "In Review", "Approved", "Done"]);
    const xs = l.zones.map((z) => z.x);
    expect([...xs].sort((a, b) => a - b)).toEqual(xs);
    expect(new Set(l.units.map((u) => `${u.x},${u.z}`)).size).toBe(l.units.length);
  });

  test("every board card is exactly one crate in its zone", () => {
    const s = mixed();
    const l = computeLayout(s);
    for (const col of s.board!.columns) {
      expect(l.crates.filter((c) => c.state === col.name).map((c) => c.identifier).sort()).toEqual(col.cards.map((c) => c.identifier).sort());
    }
    expect(l.issues.map((i) => i.identifier)).not.toContain("FX-108"); // Done older than 7 days stays hidden
    expect(new Set(l.crates.map((c) => c.identifier)).size).toBe(l.crates.length);
  });

  test("orders a zone by updatedAt, oldest first", () => {
    const l = computeLayout(withColumn("Todo", [card(1, "2026-03-01T00:00:00Z"), card(2, "2026-01-01T00:00:00Z"), card(3, "2026-02-01T00:00:00Z")]));
    expect(l.crates.map((c) => c.identifier)).toEqual(["FX-2", "FX-3", "FX-1"]);
    const zoneX = l.zones[0].x;
    expect({ x: l.crates[0].x, z: l.crates[0].z }).toEqual(slotPosition(zoneX, 0));
    expect({ x: l.crates[2].x, z: l.crates[2].z }).toEqual(slotPosition(zoneX, 2));
  });

  test("cards without updatedAt keep the board's order", () => {
    expect(orderCards([card(3), card(1), card(2)]).map((c) => c.identifier)).toEqual(["FX-3", "FX-1", "FX-2"]);
  });

  test("13 crates give 12 crates plus a +1 stack holding the newest", () => {
    const cards = Array.from({ length: 13 }, (_, i) => card(i + 1, new Date(Date.UTC(2026, 0, i + 1)).toISOString()));
    const l = computeLayout(withColumn("In Review", cards));
    expect(l.crates).toHaveLength(MAX_VISIBLE);
    expect(l.overflows).toHaveLength(1);
    expect(l.overflows[0]).toMatchObject({ id: overflowId("In Review"), label: "+1", count: 1, identifiers: ["FX-13"] });
    expect(l.issues).toHaveLength(13);
    expect(l.zones.find((z) => z.name === "In Review")!.total).toBe(13);
    expect(new Set(l.crates.map((c) => `${c.x},${c.z}`)).size).toBe(MAX_VISIBLE);
  });

  test("exactly 12 crates make no stack; 20 make +8", () => {
    expect(computeLayout(withColumn("Todo", Array.from({ length: 12 }, (_, i) => card(i)))).overflows).toHaveLength(0);
    expect(computeLayout(withColumn("Todo", Array.from({ length: 20 }, (_, i) => card(i)))).overflows[0].label).toBe("+8");
  });

  test("a WORKING station beams to its crate, or to the stack holding it", () => {
    const s = mixed();
    const worker = s.stations.find((x) => x.status === "WORKING" && x.currentIssue)!;
    const direct = computeLayout(s).beams.find((b) => b.unitId === `station:${worker.key}`)!;
    expect(direct.objectId).toBe(`crate:${worker.currentIssue!.identifier}`);

    const stacked = withColumn("In Progress", Array.from({ length: 13 }, (_, i) => card(i + 1)));
    stacked.stations.find((x) => x.key === worker.key)!.currentIssue = { identifier: "FX-13", title: "", url: "" };
    expect(computeLayout(stacked).beams.find((b) => b.unitId === `station:${worker.key}`)!.objectId).toBe(overflowId("In Progress"));
  });

  test("no beam when the current issue is not on the board", () => {
    expect(computeLayout(withColumn("Todo", [])).beams).toHaveLength(0);
  });

  test("Linear not connected gives empty zones and no crates", () => {
    const s = mixed();
    s.board = null;
    const l = computeLayout(s);
    expect(l.boardAvailable).toBe(false);
    expect(l.zones).toHaveLength(5);
    expect(l.crates).toHaveLength(0);
  });
});

describe("unit looks", () => {
  const statuses: Status[] = ["WORKING", "IDLE", "PAUSED", "ERROR", "UNKNOWN", "ON DEMAND"];
  test("every state has its own glyph, so state is never color-only", () => {
    expect(new Set(statuses.map((s) => unitLook(s).glyph)).size).toBe(statuses.length);
  });
  test("WORKING pulses amber, IDLE breathes, ERROR is red, UNKNOWN is outline only, PAUSED is still", () => {
    expect(unitLook("WORKING")).toMatchObject({ motion: "pulse", emissive: "#ff5e00" });
    expect(unitLook("IDLE").motion).toBe("breathe");
    expect(unitLook("ERROR")).toMatchObject({ emissive: "#ff003c", motion: "none" });
    expect(unitLook("UNKNOWN").outlineOnly).toBe(true);
    expect(unitLook("PAUSED")).toMatchObject({ motion: "none", glyph: "||" });
  });
});

describe("motion", () => {
  test("ease-in-out runs 0 to 1 and clamps", () => {
    expect(easeInOut(-1)).toBe(0);
    expect(easeInOut(0.5)).toBe(0.5);
    expect(easeInOut(2)).toBe(1);
  });
  test("reduced motion freezes the emissive scale", () => {
    expect(emissiveScale("pulse", 0.5, true)).toBe(1);
    expect(emissiveScale("breathe", 1.5, true)).toBe(1);
    expect(emissiveScale("pulse", 1.5, false)).toBeCloseTo(0.4);
  });
  test("frames are requested only while something animates", () => {
    expect(frameMode(["pulse", "breathe"], false)).toBe("fast");
    expect(frameMode(["breathe", "none"], false)).toBe("slow");
    expect(frameMode(["none"], false)).toBe("none");
    expect(frameMode(["pulse"], true)).toBe("none");
  });
});

describe("camera pose", () => {
  test("accepts a valid pose and rejects bad, unsafe or below-floor ones", () => {
    const good = { position: [0, 17, 23], target: [0, 0, 0.5] };
    expect(parseCamera(JSON.stringify(good))).toEqual(good as any);
    expect(parseCamera(null)).toBeNull();
    expect(parseCamera("{not json")).toBeNull();
    expect(parseCamera(JSON.stringify({ position: [0, "x", 3], target: [0, 0, 0] }))).toBeNull();
    expect(parseCamera(JSON.stringify({ position: [0, -5, 20], target: [0, 0, 0] }))).toBeNull();
    expect(parseCamera(JSON.stringify({ position: [0, 500, 0], target: [0, 0, 0] }))).toBeNull();
  });
  test("the default pulls back on narrow panels and is itself a valid pose", () => {
    const wide = defaultCamera(2.5), narrow = defaultCamera(1);
    expect(narrow.position[1]).toBeGreaterThan(wide.position[1]);
    expect(parseCamera(JSON.stringify(narrow))).not.toBeNull();
    expect(parseCamera(JSON.stringify(wide))).not.toBeNull();
  });
});
