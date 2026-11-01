import { describe, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { request } from "node:http";
import { resolve } from "node:path";
import { isAllowedHost } from "../server/host";

const root = resolve(import.meta.dir, "..");

describe("exact loopback Host allowlist", () => {
  for (const host of ["127.0.0.1:18095", "localhost:18095", "LOCALHOST:18095", "LocalHost:18095"]) {
    test(`accepts ${host}`, () => expect(isAllowedHost(host, 18095)).toBe(true));
  }
  for (const host of [null, "", "attacker.example:18095", "127.0.0.1:1", "127.0.0.1.attacker.example:18095", "localhost", "localhost.:18095", "localhost:018095", "[::1]:18095", "127.1:18095", "user@localhost:18095", "localhost:18095,attacker.example", " localhost:18095", "localhost:18095 "]) {
    test(`rejects ${JSON.stringify(host)}`, () => expect(isAllowedHost(host, 18095)).toBe(false));
  }
});

// A non-browser client can supply synthetic Host values.
function probe(port: number, path: string, host: string, method = "GET"): Promise<{ status: number; type: string; body: string }> {
  return new Promise((resolve, reject) => {
    const req = request({ hostname: "127.0.0.1", port, path, method, headers: { Host: host } }, (res) => {
      let body = "";
      const result = () => ({ status: res.statusCode!, type: String(res.headers["content-type"]), body });
      res.setEncoding("utf8");
      res.on("data", (part) => {
        body += part;
        if (res.headers["content-type"] === "text/event-stream" && body.includes("\n\n")) {
          resolve(result());
          res.destroy();
        }
      });
      res.on("end", () => resolve(result()));
      res.on("error", reject);
    });
    req.setTimeout(5000, () => req.destroy(new Error("request timeout")));
    req.on("error", reject);
    req.end();
  });
}

test("Host gate protects every real route before method handling", async () => {
  // Only lifetime is wrapped; every request uses the shipped server and handler.
  const wrapper = `
    const serve = Bun.serve; let server, handler;
    Bun.serve = (opts) => { handler = opts.fetch; server = serve(opts); return server; };
    const close = async () => { if (server) await server.stop(true); process.exit(0); };
    process.stdin.once('data', close); process.stdin.resume();
    setTimeout(close, 25000);
    await import('./server/index.ts');
    // Bun rejects a wire-level missing Host at its HTTP parser (400), before fetch.
    // Exercise the actual fetch handler directly for the specified missing-Host 403.
    for (const path of ['/api/health', '/api/snapshot', '/api/stream', '/', '/%ZZ', '/api/missing']) {
      for (const method of ['GET', 'POST', 'HEAD']) {
        const req = new Request('http://127.0.0.1:' + server.port + path, { method });
        if (req.headers.has('host')) throw new Error('fixture unexpectedly has Host');
        const r = await handler(req);
        if (r.status !== 403 || await r.text() !== '{"error":"forbidden host"}') {
          throw new Error('missing Host reached route: ' + method + ' ' + path);
        }
      }
    }
    console.log('HOSTLESS_OK=18 READY_PORT=' + server.port);
  `;
  const env: Record<string, string> = { FACTORY_FIXTURES: resolve(root, "fixtures/mixed"), PORT: "0" };
  for (const k of ["PATH", "SystemRoot", "TEMP", "TMP", "TMPDIR"]) if (process.env[k]) env[k] = process.env[k]!;
  const child = Bun.spawn([process.execPath, "--no-env-file", "-e", wrapper], { cwd: root, env, stdin: "pipe", stdout: "pipe", stderr: "pipe" });
  try {
    const reader = child.stdout.getReader();
    let output = "";
    let port = 0;
    while (!port) {
      const { value, done } = await reader.read();
      if (done) throw new Error(`server exited before readiness: ${output}`);
      output += new TextDecoder().decode(value);
      port = Number(output.match(/READY_PORT=(\d+)/)?.[1]);
    }
    reader.releaseLock();
    expect(output).toContain("HOSTLESS_OK=18");
    expect(port).not.toBe(8095);
    for (const host of [`127.0.0.1:${port}`, `localhost:${port}`, `LOCALHOST:${port}`]) {
      for (const path of ["/api/health", "/api/snapshot", "/api/stream", "/"]) {
        const r = await probe(port, path, host);
        expect(r.status).toBe(path === "/" && !existsSync(resolve(root, "dist/index.html")) ? 503 : 200);
        if (path === "/api/health") expect(JSON.parse(r.body)).toEqual({ ok: true });
        if (path === "/api/snapshot") expect(JSON.parse(r.body).mode).toBe("fixtures");
        if (path === "/api/stream") expect(r.body).toContain("event: snapshot\ndata:");
        if (path === "/" && r.status === 200) expect(r.type).toContain("text/html");
      }
      expect((await probe(port, "/api/health", host, "POST")).status).toBe(405);
      expect((await probe(port, "/api/health", host, "HEAD")).status).toBe(200);
    }
    for (const host of [`attacker.example:${port}`, "127.0.0.1:1", `127.0.0.1.attacker.example:${port}`]) {
      for (const path of ["/api/health", "/api/snapshot", "/api/stream", "/", "/%ZZ", "/api/missing"]) {
        for (const method of ["GET", "POST", "HEAD"]) {
          const r = await probe(port, path, host, method);
          expect(r.status, `${method} ${path} Host=${JSON.stringify(host)}`).toBe(403);
          expect(r.type).toContain("application/json");
          expect(r.body).toBe(method === "HEAD" ? "" : '{"error":"forbidden host"}');
        }
      }
    }
  } finally {
    child.stdin.write("close\n");
    child.stdin.end();
    expect(await child.exited).toBe(0);
  }
}, 30000);
