// The single station -> Hermes job map. Paths are relative to HERMES_HOME.
export type Lane = "build" | "review" | "integrate";

export interface Station {
  key: string;
  name: string;
  role: string;
  profile: string; // "default" = Hermes home itself
  jobsFile: string;
  jobId: string;
  lane: Lane | null;
  kind: "gatekeeper" | "lane" | "crm";
}

export const STATIONS: Station[] = [
  { key: "gatekeeper", name: "Gatekeeper", role: "Dispatcher (script)", profile: "default", jobsFile: "cron/jobs.json", jobId: "1a9fb621f161", lane: null, kind: "gatekeeper" },
  { key: "build-agentic", name: "Build · agentic (Mason)", role: "Builder", profile: "builder", jobsFile: "profiles/builder/cron/jobs.json", jobId: "9b7b5987bcd6", lane: "build", kind: "lane" },
  { key: "build-crm", name: "Build · crm (Mason)", role: "Builder", profile: "builder", jobsFile: "profiles/builder/cron/jobs.json", jobId: "1dd429fe03b2", lane: null, kind: "crm" },
  { key: "review", name: "Review (Quinn)", role: "Reviewer", profile: "reviewer", jobsFile: "profiles/reviewer/cron/jobs.json", jobId: "8e5c37a23b91", lane: "review", kind: "lane" },
  { key: "integrate", name: "Integrate (Harper)", role: "Integrator", profile: "integrator", jobsFile: "profiles/integrator/cron/jobs.json", jobId: "4e7a4d9c5fa4", lane: "integrate", kind: "lane" },
];

// Paused ROLLBACK jobs in the default profile: not stations, listed under Logan only.
export const ROLLBACK_JOB_IDS = ["a1ca59d16be5", "66efec8197dc", "a8004c5f3bab", "a5d6e054f3fa"];

export const CRM_PROJECT = "Wolftac CRM v2";

export function profileDir(profile: string): string {
  return profile === "default" ? "" : `profiles/${profile}`;
}

export interface JobMapEntry { state: string; jobId: string; profile: string }

/** Parse DEFAULT_JOB_MAP = { "lane": ("State", "jobid", "profile"), ... } from the gatekeeper script. */
export function parseDefaultJobMap(source: string): Record<string, JobMapEntry> | null {
  const block = source.match(/DEFAULT_JOB_MAP\s*=\s*\{([\s\S]*?)\n\}/);
  if (!block) return null;
  const out: Record<string, JobMapEntry> = {};
  const re = /["'](\w+)["']\s*:\s*\(\s*["']([^"']*)["']\s*,\s*["']([0-9a-fA-F]+)["']\s*,\s*["']([\w-]+)["']\s*,?\s*\)/g;
  for (const m of block[1].matchAll(re)) out[m[1]] = { state: m[2], jobId: m[3], profile: m[4] };
  return out;
}

/** Lanes whose DEFAULT_JOB_MAP entry disagrees with the station map. */
export function jobMapMismatches(map: Record<string, JobMapEntry>): string[] {
  const bad: string[] = [];
  for (const s of STATIONS) {
    if (!s.lane) continue;
    const e = map[s.lane];
    if (!e || e.jobId !== s.jobId || e.profile !== s.profile) bad.push(s.lane);
  }
  return bad;
}
