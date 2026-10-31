# Wolftac Factory Console

Live local console for the Wolftac software factory: org chart, who is working and who is idle,
and the Linear Factory Queue conveyor. A slot is reserved for the 3D "HUD twin" of the factory
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

`bun test` runs the unit tests (status rules, redaction, Linear mapper, snapshot allow-list, Zeus).

## Configuration

Copy `.env.example` to `.env` (gitignored). Bun loads it automatically.

| Variable | Meaning |
|---|---|
| `PORT` | Defaults to `8095`. |
| `HERMES_HOME` | Defaults to `%LOCALAPPDATA%\hermes`. Read-only. |
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

Every response carries `Content-Security-Policy: frame-ancestors 'self' http://127.0.0.1:8081 http://localhost:8081`.

## Safety

- Read-only: no control actions, no writes to Hermes home or Linear (GraphQL queries only).
- Only allow-listed job fields are read into the snapshot (never prompts, base URLs, delivery
  targets, toolsets, workdirs, pids or argv). Run output excerpts show only the response section.
- Every free-text field passes through regex redaction (`server/redact.ts`).
