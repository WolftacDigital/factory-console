// Fake hermes CLI for tests. Point HERMES_EXE here. It only touches paths it is explicitly given.
// FAKE_HERMES_ARGV_FILE   append one JSON line of {argv} per invocation
// FAKE_HERMES_HOME        when set, pause/resume flip the job in this fixture home's jobs.json
// FAKE_HERMES_RUN_SECONDS how long `cron run` sleeps (default 60)
// FAKE_HERMES_DELAY_MS    how long pause/resume take (default 0)
// FAKE_HERMES_FAIL        when set, pause/resume print it to stderr and exit 3
import { appendFileSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const argv = process.argv.slice(2);
if (process.env.FAKE_HERMES_ARGV_FILE) appendFileSync(process.env.FAKE_HERMES_ARGV_FILE, JSON.stringify({ argv }) + "\n");

const hasProfile = argv[0] === "-p";
const profile = hasProfile ? argv[1] : null;
const [group, verb, jobId] = argv.slice(hasProfile ? 2 : 0);
if (group !== "cron") process.exit(2);

if (verb === "run") {
  await Bun.sleep(Number(process.env.FAKE_HERMES_RUN_SECONDS ?? 60) * 1000);
  process.exit(0);
}

await Bun.sleep(Number(process.env.FAKE_HERMES_DELAY_MS ?? 0));
if (process.env.FAKE_HERMES_FAIL) {
  console.error(process.env.FAKE_HERMES_FAIL);
  process.exit(3);
}

const home = process.env.FAKE_HERMES_HOME;
if (home && (verb === "pause" || verb === "resume")) {
  const file = join(home, ...(profile ? ["profiles", profile] : []), "cron", "jobs.json");
  const data = JSON.parse(readFileSync(file, "utf8"));
  const job = data.jobs.find((j: any) => j.id === jobId);
  if (job) {
    job.enabled = true;
    job.state = verb === "pause" ? "paused" : "scheduled";
    job.paused_at = verb === "pause" ? "@now" : null;
    job.paused_reason = verb === "pause" ? "Paused from fake CLI" : null;
    writeFileSync(file, JSON.stringify(data, null, 2) + "\n");
  }
}
process.exit(0);
