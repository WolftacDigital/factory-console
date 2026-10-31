import { expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { ActionsList } from "../web/src/components/ActionsPanel";
import { ConfirmDialog } from "../web/src/components/ConfirmDialog";
import { Controls } from "../web/src/components/Controls";
import { QueueBoard } from "../web/src/components/QueueBoard";
import { RequeueDialog } from "../web/src/components/RequeueDialog";
import { canRequeue, confirmText } from "../web/src/actions";
import type { Snapshot, StationView } from "../web/src/types";

const base = { key: "review", name: "Review (Quinn)", profile: "reviewer", jobId: "8e5c37a23b91" } as StationView;

test("confirmation text names station, profile, job id and effect, as in the spec", () => {
  expect(confirmText(base, "pause").body).toBe("Pause Review (Quinn) · reviewer · 8e5c37a23b91. The gatekeeper will stop dispatching this lane until resumed.");
  expect(confirmText({ ...base, key: "gatekeeper", name: "Gatekeeper", profile: "default", jobId: "1a9fb621f161" }, "resume").body).toContain("Gatekeeper · default · 1a9fb621f161");
  expect(confirmText(base, "run").body).toContain("does not wait");
});

test("disabled buttons expose their reason as visible text", () => {
  const html = renderToStaticMarkup(<Controls dryRun={false} station={{ ...base, controls: {
    pause: { enabled: false, reason: "Already paused" }, resume: { enabled: true, reason: null }, run: { enabled: false, reason: "Resume first" },
  } }} />);
  expect(html).toContain("Already paused");
  expect(html).toContain("Resume first");
  expect((html.match(/aria-disabled="true"/g) ?? []).length).toBe(2);
  expect((html.match(/aria-disabled="false"/g) ?? []).length).toBe(1);
});

test("a station without controls renders nothing", () => {
  expect(renderToStaticMarkup(<Controls dryRun={false} station={base} />)).toBe("");
});

test("dialog puts Cancel first and is a labelled modal", () => {
  const html = renderToStaticMarkup(<ConfirmDialog title="T" onConfirm={() => {}} onCancel={() => {}}><p>B</p></ConfirmDialog>);
  expect(html).toContain('aria-modal="true"');
  expect(html.indexOf("Cancel")).toBeLessThan(html.indexOf("Confirm"));
});

test("reason field has a visible label", () => {
  const html = renderToStaticMarkup(<RequeueDialog card={{ identifier: "FX-1", title: "t" }} from="In Review" onConfirm={() => {}} onCancel={() => {}} />);
  expect(html).toContain('for="reason-FX-1"');
  expect(html).toContain("Reason (at least 10 characters)");
});

test("the board offers Requeue on In Progress, In Review and Approved only (AC-11)", () => {
  const card = (id: string) => ({ identifier: id, title: id, url: "", lane: "x", assignee: null, delegate: null, project: null });
  const names = ["Todo", "In Progress", "In Review", "Approved", "Done"];
  const snap = {
    sources: { linear: { state: "connected", reason: null } },
    actions: { hermes: { available: true, reason: null }, linear: { available: true, reason: null }, dryRun: false },
    board: { columns: names.map((n) => ({ name: n, label: n, cards: [card(n.replace(" ", "-"))] })) },
  } as unknown as Snapshot;
  const html = renderToStaticMarkup(<QueueBoard snap={snap} />);
  expect(html).toContain('aria-label="Requeue In-Progress"');
  expect(html).toContain('aria-label="Requeue In-Review"');
  expect(html).toContain('aria-label="Requeue Approved"');
  expect(html).not.toContain('aria-label="Requeue Todo"');
  expect(html).not.toContain('aria-label="Requeue Done"');
  expect(canRequeue("Todo") || canRequeue("Done")).toBe(false);
});

test("without Linear, Requeue is disabled with the reason as text", () => {
  const snap = {
    sources: { linear: { state: "connected", reason: null } },
    actions: { hermes: { available: true, reason: null }, linear: { available: false, reason: "Linear not connected" }, dryRun: false },
    board: { columns: [{ name: "In Review", label: "In Review", cards: [{ identifier: "A-1", title: "t", url: "", lane: "x", assignee: null, delegate: null, project: null }] }] },
  } as unknown as Snapshot;
  const html = renderToStaticMarkup(<QueueBoard snap={snap} />);
  expect(html).toContain('aria-disabled="true"');
  expect(html).toContain("Linear not connected");
});

test("empty action log says so", () => {
  expect(renderToStaticMarkup(<ActionsList entries={[]} />)).toContain("No actions yet");
});

test("action rows show time, action, target, result and backup", () => {
  const html = renderToStaticMarkup(<ActionsList entries={[{ ts: "2026-01-02T03:04:05Z", action: "pause", target: "review", profile: "reviewer", jobId: "j", issue: null, reason: null, result: "ok", error: null, backup: "C:/x/jobs.json.bak", durationMs: 5 }]} />);
  for (const t of ["pause", "review", "ok", "C:/x/jobs.json.bak"]) expect(html).toContain(t);
});
