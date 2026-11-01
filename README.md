# Wolftac Factory Console

Live local console for the Wolftac software factory: org chart, who is working and who is idle,
the Linear Factory Queue conveyor, and deliberate controls for the factory's workers. A slot is reserved for the 3D "HUD twin" of the factory
floor (next build).

Runs locally only (binds to `127.0.0.1`). It reads factory state from this machine's Hermes install
and from Linear; no factory data or secrets are stored in this repository. It is shown inside
Agentic OS under **Factory**.

Specs live in Linear (team Wolftac Digital, label `Factory Queue`).

## Run

```sh
bun install
bun run build
bun run start        # http://127.0.0.1:8095
```

Or double-click `Start Factory Console.bat`.

`bun test` runs the unit tests (status rules, redaction, Linear mapper, snapshot allow-list, Zeus, action guards) and
end-to-end control tests against a temp copy of the fixtures, `fixtures/fake-hermes` and `fixtures/mock-linear`. They use ports 8123 and 8124.

## Configuration

Copy `.env.example` to `.env` (gitignored). Bun loads it automatically.

| Variable | Meaning |
|---|---|
| `PORT` | Defaults to `8095`. |
| `HERMES_HOME` | Defaults to `%LOCALAPPDATA%\hermes`. Read directly; changed only through the `hermes` CLI. |
| `HERMES_EXE` | Optional CLI override. Defaults to the Hermes venv's `hermes.exe`. A `.ts`/`.js` path runs under Bun (the fake CLI in tests). Fixture mode requires it: there is no fallback to the installed CLI. |
| `LINEAR_API_URL` | Optional endpoint override for a mock. Defaults to `https://api.linear.app/graphql`. Fixture mode requires it for requeue. |
| `FACTORY_ACTIONS_DRYRUN` | `1` logs the exact command and backup each action would use and changes nothing. |
| `FACTORY_DATA_DIR` | Optional folder for the action log. Defaults to `.data/`. |
| `LINEAR_API_KEY` | Personal Linear API key. Without it the board shows "Linear not connected". |
| `ZEUS_STATUS_URL` | Optional. GET returning `{"state":"working|idle|paused|error","detail":"..."}`. |
| `FACTORY_FIXTURES` | Optional directory used in place of Hermes home, plus `linear.json`. |

## Fixtures

`FACTORY_FIXTURES=fixtures/mixed bun run start` serves synthetic data: one WORKING, one IDLE, one
PAUSED and one ERROR worker, plus issues in every board column. In fixture files only, timestamps
written as `@now`, `@now-15m`, `@now+2h` or `@now-3d` are resolved relative to server start, so
the fixtures stay inside the 90-minute / 24-hour / 7-day windows on any day.

## API

- `GET /api/snapshot`: full redacted state.
- `GET /api/stream`: Server-Sent Events. One `snapshot` event on connect, one per change, heartbeat every 20s.
- `GET /api/health`: `{"ok":true}`.
- `GET /api/session`: `{ token }`, a random token created when the process starts.
- `GET /api/actions/log?limit=50`: recent actions, newest first.
- `POST /api/actions/station/:stationId/pause|resume|run`, for `gatekeeper`, `build-agentic`, `build-crm`, `review`, `integrate`.
- `POST /api/actions/issue/:identifier/requeue` with `{ "reason": string }` (at least 10 characters).

Every POST needs `Origin: http://127.0.0.1:8095` or `http://localhost:8095`, the token in `X-Console-Token`
and `Content-Type: application/json`. Any failure is a 403. The allowed origins are fixed to port 8095,
so controls refuse every request when the console's page is served from another `PORT`.

Every response carries `Content-Security-Policy: frame-ancestors 'self' http://127.0.0.1:8081 http://localhost:8081`.

## Safety

- Reads never write. Controls change Hermes only through `hermes [-p <profile>] cron pause|resume|run <jobId>`,
  spawned as an argument array, with the profile and job id taken from `server/stations.ts`, never from the request.
- Pause and resume first copy `cron/jobs.json` to `jobs.json.bak-<stamp>-console-<action>` and verify its hash;
  a failed backup aborts the action. Backups are never deleted automatically.
- Run now is launched detached and never awaited or killed. It is refused while the station is working,
  while its lane has a dispatch under 90 minutes old, or while the job is paused.
- Requeue moves a `Factory Queue` issue from In Progress, In Review or Approved to Todo and adds a comment. It is the
  only Linear write. There is no path to merge, approve or finish an issue, and none to chat or code hosting services.
- Every attempt, including refusals, appends one redacted line to `.data/actions.jsonl` (gitignored, rotated at 5 MB, keeps 5).
- Only allow-listed job fields are read into the snapshot (never prompts, base URLs, delivery
  targets, toolsets, workdirs, pids or argv). Run output excerpts show only the response section.
- Every free-text field passes through regex redaction (`server/redact.ts`).
