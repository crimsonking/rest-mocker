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

Layout: `lib/` holds the framework-agnostic core (matcher, SQLite-backed store, shared validation, config loader, response assembly); `app/%5Fmocks/` is the admin API (Next.js requires the `%5F` folder escape to serve the literal `/_mocks` URL); `app/[[...slug]]/route.ts` is the catch-all mock handler; `instrumentation.ts` seeds the config at startup when the store is empty; `scripts/` holds the prestart config gate (`check-mocks.ts`, wired via `predev`/`prestart`) and the smoke test.
