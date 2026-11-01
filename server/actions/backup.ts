// Verified copy of a profile's jobs.json, taken before every pause or resume. Failure aborts the action.
import { constants, copyFileSync, existsSync, readFileSync, unlinkSync } from "node:fs";
import { createHash } from "node:crypto";
import { join } from "node:path";
import { profileDir, type Station } from "../stations";

export type BackupVerb = "pause" | "resume";
export type BackupResult = { ok: true; path: string } | { ok: false; error: string };

export function backupStamp(d: Date): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
}

export function jobsJsonPath(home: string, station: Pick<Station, "profile">): string {
  return join(home, profileDir(station.profile), "cron", "jobs.json");
}

export function backupPath(source: string, verb: BackupVerb, when: Date): string {
  return `${source}.bak-${backupStamp(when)}-console-${verb}`;
}

const sha256 = (path: string) => createHash("sha256").update(readFileSync(path)).digest("hex");

export interface BackupDeps {
  copy?: (from: string, to: string) => void;
  now?: () => Date;
  wait?: (ms: number) => Promise<void>;
}

/** Copies jobs.json beside itself, never overwriting, and proves the copy's hash matches. */
export async function backupJobs(source: string, verb: BackupVerb, deps: BackupDeps = {}): Promise<BackupResult> {
  const copy = deps.copy ?? ((from, to) => copyFileSync(from, to, constants.COPYFILE_EXCL));
  const now = deps.now ?? (() => new Date());
  const wait = deps.wait ?? ((ms) => new Promise<void>((r) => setTimeout(r, ms)));
  let dest = backupPath(source, verb, now());
  // Two stations share the builder profile, so a same-second backup waits for the next stamp.
  for (let i = 0; i < 3 && existsSync(dest); i++) {
    await wait(1100);
    dest = backupPath(source, verb, now());
  }
  try {
    copy(source, dest);
    if (sha256(source) !== sha256(dest)) {
      try {
        unlinkSync(dest);
      } catch {}
      return { ok: false, error: "backup hash mismatch" };
    }
    return { ok: true, path: dest };
  } catch (e: any) {
    return { ok: false, error: `backup could not be written (${e?.code ?? "error"})` };
  }
}
