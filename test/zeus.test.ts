import { describe, expect, test } from "bun:test";
import { fetchZeus } from "../server/sources/zeus";

describe("fetchZeus", () => {
  test("no URL -> not configured", async () => expect(await fetchZeus(undefined)).toEqual({ configured: false }));
  test("valid JSON -> reported state", async () => {
    const f = (async () => new Response(JSON.stringify({ state: "working", detail: "d" }))) as unknown as typeof fetch;
    expect(await fetchZeus("http://127.0.0.1:1/s", f)).toEqual({ configured: true, ok: true, state: "working", detail: "d" });
  });
  test("invalid JSON shape -> not ok", async () => {
    const f = (async () => new Response(JSON.stringify({ state: "dancing" }))) as unknown as typeof fetch;
    expect((await fetchZeus("http://127.0.0.1:1/s", f)) as any).toMatchObject({ ok: false });
  });
  test("timeout -> not ok within ~3s", async () => {
    const f = ((_u: string, init: any) => new Promise((_r, rej) => init.signal.addEventListener("abort", () => rej(new Error("aborted"))))) as unknown as typeof fetch;
    const t0 = Date.now();
    const r = await fetchZeus("http://10.255.255.1/s", f);
    expect(r).toEqual({ configured: true, ok: false, reason: "timeout after 3s" });
    expect(Date.now() - t0).toBeLessThan(4000);
  }, 6000);
});
