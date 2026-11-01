// Append-only JSON Lines action log, redacted. Rotates at 5 MB, keeping 5 rotated files.
import { appendFileSync, existsSync, mkdirSync, readFileSync, readdirSync, renameSync, statSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import { redact } from "../redact";

export interface ActionLogEntry {
  ts: string;
  action: string;
  target: string | null;
  profile: string | null;
  jobId: string | null;
  issue: string | null;
  reason: string | null;
  result: string;
  error: string | null;
  backup: string | null;
  durationMs: number;
  command?: string | null;
}

export const ROTATE_BYTES = 5 * 1024 * 1024;
export const KEEP_ROTATED = 5;
const MAX_FIELD = 1000;
const ROTATED = /^actions-\d{8}-\d{6}-\d{3}(-\d+)?\.jsonl$/;

const clean = (v: string | null | undefined) => (v === null || v === undefined ? null : redact(v).slice(0, MAX_FIELD));

function stamp(d: Date): string {
  const p = (n: number, w = 2) => String(n).padStart(w, "0");
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}-${p(d.getMilliseconds(), 3)}`;
}

export class ActionLog {
  readonly file: string;
  constructor(readonly dir: string, private rotateBytes = ROTATE_BYTES, private keep = KEEP_ROTATED) {
    this.file = join(dir, "actions.jsonl");
  }

  private rotated(): string[] {
    try {
      return readdirSync(this.dir).filter((n) => ROTATED.test(n)).sort();
    } catch {
      return [];
    }
  }

  private rotateIfNeeded() {
    if (!existsSync(this.file) || statSync(this.file).size < this.rotateBytes) return;
    const base = `actions-${stamp(new Date())}`;
    let name = `${base}.jsonl`;
    for (let i = 1; existsSync(join(this.dir, name)); i++) name = `${base}-${i}.jsonl`;
    renameSync(this.file, join(this.dir, name));
    const all = this.rotated();
    for (const old of all.slice(0, Math.max(0, all.length - this.keep))) unlinkSync(join(this.dir, old));
  }

  /** Writes one redacted line. A log failure is reported to the caller's console, never thrown into an action. */
  append(entry: Omit<ActionLogEntry, "ts" | "target" | "profile" | "jobId" | "issue" | "reason" | "error" | "backup" | "durationMs"> & Partial<ActionLogEntry>): void {
    const line: ActionLogEntry = {
      ts: entry.ts ?? new Date().toISOString(),
      action: clean(entry.action) ?? "unknown",
      target: clean(entry.target),
      profile: clean(entry.profile),
      jobId: clean(entry.jobId),
      issue: clean(entry.issue),
      reason: clean(entry.reason),
      result: clean(entry.result) ?? "unknown",
      error: clean(entry.error),
      backup: clean(entry.backup),
      durationMs: entry.durationMs ?? 0,
    };
    if (entry.command) line.command = clean(entry.command);
    try {
      mkdirSync(this.dir, { recursive: true });
      this.rotateIfNeeded();
      appendFileSync(this.file, JSON.stringify(line) + "\n", "utf8");
    } catch (e: any) {
      console.error(`action log write failed: ${e?.code ?? "error"}`);
    }
  }

  /** Newest first, reading into rotated files when the current one is short. */
  recent(limit = 50): ActionLogEntry[] {
    const out: ActionLogEntry[] = [];
    const files = [this.file, ...this.rotated().reverse().map((n) => join(this.dir, n))];
    for (const f of files) {
      let text: string;
      try {
        text = readFileSync(f, "utf8");
      } catch {
        continue;
      }
      const lines = text.split("\n").filter(Boolean).reverse();
      for (const l of lines) {
        if (out.length >= limit) return out;
        try {
          out.push(JSON.parse(l));
        } catch {}
      }
    }
    return out;
  }
}
