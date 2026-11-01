import { expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { join } from "node:path";
import { OrgChart } from "../web/src/components/OrgChart";
import { buildSnapshot } from "../server/snapshot";
import { readHermes } from "../server/sources/hermes";
import { readLinearFixture } from "../server/sources/linear";

const fixture = join(import.meta.dir, "../fixtures/mixed");
test("WORKING node renders an issue link beside, never inside, its detail button", async () => {
  const snap = { ...buildSnapshot(readHermes(fixture, { fixtures: true }), null,
    readLinearFixture(join(fixture, "linear.json")), { configured: false }, Date.now(), "fixtures"),
    updatedAt: new Date().toISOString() };
  const html = renderToStaticMarkup(<OrgChart snap={snap} onOpen={() => {}} />);
  const links: string[] = [];
  const detailLabels: string[] = [];
  let nestedInteractive = 0;
  await new HTMLRewriter()
    .on(".station-node a.issue", { element(el) { links.push(el.getAttribute("href")!); } })
    .on(".station-node button", { element(el) { detailLabels.push(el.getAttribute("aria-label")!); } })
    .on("button a, a button", { element() { nestedInteractive++; } })
    .transform(new Response(html)).text();
  expect(links).toEqual([snap.stations.find((s) => s.key === "build-agentic")!.currentIssue!.url]);
  expect(detailLabels).toHaveLength(5);
  expect(detailLabels.some((l) => l.includes("Build · agentic (Mason), WORKING. Open details"))).toBe(true);
  expect(nestedInteractive).toBe(0);
});

test("an agent job with no model pin reads as the profile default, only the Gatekeeper as a script", () => {
  const base = buildSnapshot(readHermes(fixture, { fixtures: true }), null,
    readLinearFixture(join(fixture, "linear.json")), { configured: false }, Date.now(), "fixtures");
  const snap = { ...base, updatedAt: new Date().toISOString(),
    stations: base.stations.map((s) => s.key === "integrate" || s.key === "gatekeeper" ? { ...s, model: null, provider: null } : s) };
  const html = renderToStaticMarkup(<OrgChart snap={snap} onOpen={() => {}} />);
  expect(html.match(/no model \(script\)/g)).toHaveLength(1);
  expect(html.match(/profile default model/g)).toHaveLength(1);
});
