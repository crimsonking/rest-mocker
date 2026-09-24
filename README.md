# mock-e2e-server

Standalone mock API server for E2E and integration tests. It accepts any HTTP request; when the request **method** and **URI** match a registered mock, it replies with the mock's pre-defined **status**, **headers**, and **body**. Built with Next.js (App Router) and TypeScript.

## Quick start

```bash
npm install
npm run dev          # http://localhost:3000
```

Requires Node.js ≥ 22.5 — mock state persists via the built-in `node:sqlite` module.

Production:

```bash
npm run build
npm start            # default port 3000; override with PORT=3100 npm start
```

The repo ships a sample `mocks.json` that seeds two demo mocks at startup:

```bash
curl http://localhost:3000/health
# {"status":"ok"}
```

## Docker

Run the server as a container image instead of a local Node.js install. The image is multi-stage (`node:26-alpine` builder → Next.js standalone bundle), runs as the non-root `node` user, and keeps the SQLite database under `/data` (`MOCK_DB_FILE=/data/mocks.db` is baked in).

```bash
docker build -t mock-e2e-server:latest .
docker run -d --name mock -p 3100:3000 mock-e2e-server:latest
curl http://127.0.0.1:3100/health          # {"status":"ok"} — seeded sample mock
```

> **Podman users:** build with `docker build --format docker -t mock-e2e-server:latest .` — podman's default OCI image format silently drops the `HEALTHCHECK` instruction. The Docker CLI uses the docker format by default.

The container listens on `PORT` (default `3000`) on all interfaces; publish it with `-p`. The image's `HEALTHCHECK` probes `GET /_mocks`: it reports healthy whenever the server process is up — independent of which mocks exist — and the probes never appear in call statistics.

### State

Without a volume, mock state is container-ephemeral: it dies with `docker rm`. Mount a named volume at `/data` to persist mocks across container recreation:

```bash
docker run -d --name mock -v mockdata:/data -p 3100:3000 mock-e2e-server:latest
```

One container per data volume — the store assumes a single owning process.

### Custom seed config

The image ships the repo's sample `mocks.json` at `/app/mocks.json`, seeded on first run against an empty store. Mount your own file over it (read-only), or point `MOCK_CONFIG_FILE` elsewhere:

```bash
docker run -d --name mock -p 3100:3000 -v ./my-mocks.json:/app/mocks.json:ro mock-e2e-server:latest
docker run -d --name mock -p 3100:3000 -e MOCK_CONFIG_FILE=/config/staging.json -v ./config:/config:ro mock-e2e-server:latest
```

Invalid config or an unwritable `/data` fails fast: the container exits non-zero before listening, and `docker logs mock` names the offending config or database path.

### Rootless podman bind mounts

Named volumes work out of the box. A host directory **bind-mounted** at `/data` fails fast under rootless podman (your host user maps to container root, so the `node` user cannot write). Add `--userns=keep-id` to map your host user onto the container's `node` user instead:

```bash
docker run -d --name mock --userns=keep-id -v ./data:/data -p 3100:3000 mock-e2e-server:latest
```

### Image verification

With a container published on port 3100, the smoke suite checks the full lifecycle:

```bash
npm run smoke          # MOCK_BASE defaults to http://127.0.0.1:3100
```

## Defining mocks

### At runtime — admin API (`/_mocks`)

Mock state is durable: it lives in a SQLite database, `mocks.db` in the project root by default (override with the `MOCK_DB_FILE` environment variable; relative paths resolve against the project root). Runtime registrations survive restarts and deletes persist. To reset, clear all mocks via `DELETE /_mocks` or delete the database file while the server is stopped. The database file is created automatically and is gitignored.

#### Register — `POST /_mocks`

```bash
curl -X POST http://localhost:3000/_mocks \
  -H 'content-type: application/json' \
  -d '{"method": "GET", "uri": "/ping", "status": 200, "headers": {"X-Trace": "abc"}, "body": "pong"}'
```

Responds `201` with the stored mock including its server-assigned `id`.

| Field | Required | Notes |
| --- | --- | --- |
| `method` | yes | `GET`, `POST`, `PUT`, `PATCH`, `DELETE`, `HEAD`, `OPTIONS` (case-insensitive) |
| `uri` | yes | Path starting with `/`; may contain `:param` segments and a final `*` wildcard; must not target `/_mocks` |
| `status` | no | Integer 100–599; defaults to `200` |
| `headers` | no | Object of string → string; sent on every matched response |
| `body` | no | Any JSON value; strings are served as `text/plain`, everything else as `application/json` (a registered `Content-Type` header wins) |

Invalid payloads get `400` with `error.details[]` naming the offending fields; nothing is registered. Registering the same `method` + `uri` again succeeds — the newer registration wins matching.

#### List — `GET /_mocks`

`200` with a JSON array of all mocks (`id`, `method`, `uri`, `status`, `headers`, `body`), oldest registration first.

#### Delete one — `DELETE /_mocks/{id}`

`204` on success; `404` with a JSON error for an unknown `id` (store unchanged).

#### Clear all — `DELETE /_mocks`

`204`; removes every mock including config-seeded ones. Seeded mocks return only after a restart.

#### Statistics — `GET /_mocks/stats`

`200` with aggregated call statistics for the current server process. Every request that reaches the mock handler — matched or unmatched — is counted per method, URI, and caller. Matched calls aggregate under the registered mock pattern (`/users/1` and `/users/2` both count toward `/users/:id`); unmatched calls aggregate under their request path with `"matched": false`. Requests to `/_mocks` itself are never counted.

```bash
curl http://localhost:3000/_mocks/stats
```

```json
{
  "callerHeader": "user-agent",
  "entries": [
    { "method": "GET", "uri": "/users/:id", "matched": true, "caller": "suite-a", "count": 3, "lastCalledAt": "2026-09-24T10:15:00.000Z" },
    { "method": "GET", "uri": "/missing", "matched": false, "caller": "suite-b", "count": 1, "lastCalledAt": "2026-09-24T10:16:00.000Z" }
  ]
}
```

Entries are ordered by `count` descending, ties broken by method, then URI, then caller. The **caller** is the value of the request header named by the `MOCK_STATS_CALLER_HEADER` environment variable (default `User-Agent`, matched case-insensitively); an absent or empty header counts as `unknown`. Pick a low-cardinality header — per-request values like trace ids create one entry per call.

Statistics live **in memory only**: they start empty at every startup and are lost on restart, unlike mocks, which persist in SQLite.

#### Reset statistics — `DELETE /_mocks/stats`

`204`; empties the journal so counting restarts at zero. Registered mocks are unaffected. Useful between test steps: reset, exercise the system, read the report.

Other admin API behavior: unsupported methods on these routes (e.g. `PUT /_mocks`, `GET /_mocks/{id}`) return `405`; unmapped subpaths (e.g. `/_mocks/a/b`) return the JSON `404`; the `/_mocks` prefix can never be served by a mock.

### At startup — `mocks.json`

A JSON array loaded when the server starts:

```json
[
  {
    "method": "GET",
    "uri": "/health",
    "status": 200,
    "headers": { "X-Mock": "seeded" },
    "body": { "status": "ok" }
  },
  { "method": "GET", "uri": "/users/:id", "body": { "name": "Demo User" } }
]
```

- Default location: `./mocks.json`. Override with the `MOCK_CONFIG_FILE` environment variable (relative paths resolve against the project root):

  ```bash
  MOCK_CONFIG_FILE=config/staging-mocks.json npm start
  ```

- A **missing** file is fine: the server starts with an empty store.
- An **invalid** file (malformed JSON, not an array, bad entry) stops the server before it listens, with an error naming the file and the offending entry.
- Entry order matters: with two entries for the same method + URI, the later one wins.
- Seeding only fills an **empty** store: entries are inserted on a fresh database (first run) or on a restart after clear-all. When the store already holds mocks, the file is still validated — an invalid file still stops the server — but nothing is inserted, so persisted state (including individual deletes of seeded mocks) survives restarts.
- Seeded mocks behave exactly like runtime ones: they appear in `GET /_mocks` with ids and can be deleted or cleared.

## Matching & precedence

- Matching is by exact HTTP method — strict, so a `HEAD` request only matches a `HEAD` mock (HEAD responses carry status and headers, never a body) — and by URI path. Query strings are ignored; a trailing slash is ignored (`/users` ≡ `/users/`).
- URI patterns: exact segments, `:param` (any single segment), and `*` (one or more remaining segments; only allowed as the final segment).
- When several mocks match one request, exactly one wins: **exact > `:param` > `*`**, compared segment by segment; identical patterns → the most recently registered mock wins.
- Unmatched requests get `404` with a JSON body naming method and path:

  ```json
  { "error": { "message": "no mock matches this request", "method": "GET", "path": "/unknown" } }
  ```

## Development

```bash
npm test             # unit + route-handler tests (vitest)
npm run build        # production build
npm run smoke        # E2E lifecycle check; requires a server on MOCK_BASE (default http://127.0.0.1:3100)
```

Layout: `lib/` holds the framework-agnostic core (matcher, SQLite-backed store, shared validation, config loader, response assembly, in-memory call-statistics journal); `app/%5Fmocks/` is the admin API (Next.js requires the `%5F` folder escape to serve the literal `/_mocks` URL); `app/[[...slug]]/route.ts` is the catch-all mock handler; `instrumentation.ts` seeds the config at startup when the store is empty; `scripts/` holds the prestart config gate (`check-mocks.ts`, wired via `predev`/`prestart`) and the smoke test.
