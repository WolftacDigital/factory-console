// Wolftac Factory Console server. Read-only, bound to 127.0.0.1 only, no auth (local tool).
import { existsSync, statSync } from "node:fs";
import { join, normalize, resolve, sep } from "node:path";
import { buildSnapshot, type Snapshot } from "./snapshot";
import { readHermes, type HermesRead } from "./sources/hermes";
import { fetchLinearIssues, readLinearFixture, type LinearResult } from "./sources/linear";
import { fetchZeus, type ZeusResult } from "./sources/zeus";

const HOST = "127.0.0.1";
const PORT = Number(process.env.PORT || 8095);
const FIXTURES = process.env.FACTORY_FIXTURES?.trim() ? resolve(process.env.FACTORY_FIXTURES.trim()) : null;
const HERMES_HOME = FIXTURES ?? (process.env.HERMES_HOME?.trim() || join(process.env.LOCALAPPDATA ?? "", "hermes"));
const DIST = resolve(import.meta.dir, "..", "dist");

const HERMES_POLL_MS = 5_000;
const LINEAR_POLL_MS = 60_000;
const ZEUS_POLL_MS = 2_000;
const HEARTBEAT_MS = 20_000;

export const SECURITY_HEADERS: Record<string, string> = {
  "Content-Security-Policy": "frame-ancestors 'self' http://127.0.0.1:8081 http://localhost:8081",
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "no-referrer",
};

let hermes: HermesRead | null = null;
let hermesError: string | null = null;
let linear: LinearResult | null = null;
let zeus: ZeusResult = { configured: false };
let snapshot: (Snapshot & { updatedAt: string }) | null = null;
let snapshotKey = "";
const clients = new Set<ReadableStreamDefaultController<Uint8Array>>();
const enc = new TextEncoder();

function log(msg: string) {
  console.log(`[${new Date().toISOString()}] ${msg}`);
}

function pollHermes() {
  try {
    if (!existsSync(HERMES_HOME)) throw new Error("HERMES_HOME not found");
    hermes = readHermes(HERMES_HOME, { fixtures: !!FIXTURES });
    hermesError = null;
  } catch (e: any) {
    hermes = null;
    hermesError = e?.message === "HERMES_HOME not found" ? "HERMES_HOME not found" : "Hermes read failed";
  }
}

async function pollLinear() {
  try {
    linear = FIXTURES ? readLinearFixture(join(FIXTURES, "linear.json")) : await fetchLinearIssues(process.env.LINEAR_API_KEY);
  } catch {
    linear = { ok: false, reason: "Linear poll failed" };
  }
  if (!linear.ok) log(`linear: not connected (${linear.reason})`);
  recompute();
}

async function pollZeus() {
  try {
    zeus = await fetchZeus(process.env.ZEUS_STATUS_URL);
  } catch {
    zeus = { configured: true, ok: false, reason: "unreachable" };
  }
  recompute();
}

function broadcast(data: string) {
  const chunk = enc.encode(data);
  for (const c of clients) {
    try {
      c.enqueue(chunk);
    } catch {
      clients.delete(c);
    }
  }
}

function recompute() {
  try {
    const next = buildSnapshot(hermes, hermesError, linear, zeus, Date.now(), FIXTURES ? "fixtures" : "live");
    const key = JSON.stringify(next);
    if (key === snapshotKey) return; // push only when content changes
    snapshotKey = key;
    snapshot = { ...next, updatedAt: new Date().toISOString() };
    broadcast(`event: snapshot\ndata: ${JSON.stringify(snapshot)}\n\n`);
  } catch (e: any) {
    log(`snapshot build failed: ${e?.message ?? e}`);
  }
}

function withHeaders(res: Response): Response {
  for (const [k, v] of Object.entries(SECURITY_HEADERS)) res.headers.set(k, v);
  return res;
}

function json(body: unknown, status = 200) {
  return withHeaders(new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" } }));
}

function stream(req: Request): Response {
  let ctrl: ReadableStreamDefaultController<Uint8Array>;
  let hb: ReturnType<typeof setInterval>;
  const body = new ReadableStream<Uint8Array>({
    start(c) {
      ctrl = c;
      clients.add(c);
      c.enqueue(enc.encode(`retry: 3000\nevent: snapshot\ndata: ${JSON.stringify(snapshot)}\n\n`));
      hb = setInterval(() => {
        try {
          c.enqueue(enc.encode(`: heartbeat ${Date.now()}\n\n`));
        } catch {
          clearInterval(hb);
        }
      }, HEARTBEAT_MS);
      req.signal.addEventListener("abort", () => {
        clearInterval(hb);
        clients.delete(c);
        try {
          c.close();
        } catch {}
      });
    },
    cancel() {
      clearInterval(hb);
      clients.delete(ctrl);
    },
  });
  return withHeaders(new Response(body, { headers: { "Content-Type": "text/event-stream", "Cache-Control": "no-store", Connection: "keep-alive" } }));
}

const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml", ".png": "image/png", ".ico": "image/x-icon", ".json": "application/json", ".woff2": "font/woff2",
};

function serveStatic(pathname: string): Response {
  let decoded: string;
  try {
    decoded = decodeURIComponent(pathname);
  } catch {
    return json({ error: "invalid path encoding" }, 400);
  }
  if (decoded.includes("\0")) return json({ error: "invalid path" }, 400);
  const rel = normalize(decoded).replace(/^([\\/])+/, "");
  let file = resolve(DIST, rel);
  if (!file.startsWith(DIST + sep) && file !== DIST) return json({ error: "not found" }, 404);
  if (!existsSync(file) || statSync(file).isDirectory()) file = join(DIST, "index.html");
  if (!existsSync(file)) return withHeaders(new Response("Client not built. Run `bun run build`.", { status: 503, headers: { "Content-Type": "text/plain" } }));
  const ext = file.slice(file.lastIndexOf("."));
  return withHeaders(new Response(Bun.file(file), { headers: { "Content-Type": MIME[ext] ?? "application/octet-stream" } }));
}

pollHermes();
recompute();

const server = Bun.serve({
  hostname: HOST,
  port: PORT,
  idleTimeout: 0, // SSE connections stay open; heartbeat keeps them alive
  fetch(req) {
    const url = new URL(req.url);
    if (req.method !== "GET" && req.method !== "HEAD") return json({ error: "read-only" }, 405);
    if (url.pathname === "/api/health") return json({ ok: true });
    if (url.pathname === "/api/snapshot") return json(snapshot);
    if (url.pathname === "/api/stream") return stream(req);
    if (url.pathname.startsWith("/api/")) return json({ error: "not found" }, 404);
    return serveStatic(url.pathname);
  },
  error() {
    return json({ error: "internal error" }, 500);
  },
});

log(`Factory Console on http://${server.hostname}:${server.port} (${FIXTURES ? "fixtures" : "live"} mode)`);

setInterval(() => {
  pollHermes();
  recompute();
}, HERMES_POLL_MS);
pollLinear();
setInterval(pollLinear, LINEAR_POLL_MS);
pollZeus();
setInterval(pollZeus, ZEUS_POLL_MS);

process.on("uncaughtException", (e) => log(`uncaught: ${e?.message ?? e}`));
process.on("unhandledRejection", (e: any) => log(`unhandled: ${e?.message ?? e}`));
