// Same-origin guard for every control POST: exact Origin, per-process token, JSON content type.
// The server never sends CORS headers, so another site can neither read the token nor pass these checks.
import { createHash, randomBytes, timingSafeEqual } from "node:crypto";

export const ALLOWED_ORIGINS = ["http://127.0.0.1:8095", "http://localhost:8095"] as const;
export const TOKEN_HEADER = "X-Console-Token";

export type GuardResult = { ok: true } | { ok: false; reason: string };

/** Random 32-byte token, created once per process. */
export function createSessionToken(): string {
  return randomBytes(32).toString("hex");
}

function sameToken(a: string, b: string): boolean {
  const sha = (s: string) => createHash("sha256").update(s).digest();
  return timingSafeEqual(sha(a), sha(b));
}

export function checkGuards(headers: Headers, token: string): GuardResult {
  const origin = headers.get("origin");
  if (!origin || !(ALLOWED_ORIGINS as readonly string[]).includes(origin)) return { ok: false, reason: "origin not allowed" };
  const sent = headers.get(TOKEN_HEADER);
  if (!sent || !sameToken(sent, token)) return { ok: false, reason: "missing or wrong console token" };
  const type = (headers.get("content-type") ?? "").split(";")[0].trim().toLowerCase();
  if (type !== "application/json") return { ok: false, reason: "content type must be application/json" };
  return { ok: true };
}
