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

The repo ships a sample `mocks.json` that seeds five demo mocks at startup:

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
| `bodySchema` | no | JSON Schema object applied to request bodies for this mock; failing bodies get `400` — see [Request body schemas](#request-body-schemas) |
| `responseSchema` | no | JSON Schema the response body is **generated** from on every call; mutually exclusive with `body` — see [Response generation from JSON Schema](#response-generation-from-json-schema) |

Invalid payloads get `400` with `error.details[]` naming the offending fields; nothing is registered. An invalid `bodySchema` (not a JSON object, or not a compilable JSON Schema) or an invalid `responseSchema` (not a JSON object, or not a schema the generator accepts) is rejected the same way, as is a payload declaring both `body` and `responseSchema`. Registering the same `method` + `uri` again succeeds — the newer registration wins matching.

#### List — `GET /_mocks`

`200` with a JSON array of all mocks (`id`, `method`, `uri`, `status`, `headers`, `body`, and `bodySchema`/`responseSchema` when declared), oldest registration first.

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

Other admin API behavior: unsupported methods on these routes (e.g. `PUT /_mocks`, `GET /_mocks/{id}`) return `405`; unmapped subpaths (e.g. `/_mocks/a/b`) return the JSON `500`; the `/_mocks` prefix can never be served by a mock.

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
  { "method": "GET", "uri": "/users/:id", "body": { "name": "Demo User" } },
  {
    "method": "POST",
    "uri": "/orders",
    "status": 201,
    "body": { "ok": true },
    "bodySchema": { "type": "object", "required": ["name"], "properties": { "name": { "type": "string" } } }
  },
  {
    "method": "GET",
    "uri": "/random-user",
    "responseSchema": { "type": "object", "required": ["id", "name"], "properties": { "id": { "type": "integer" }, "name": { "type": "string" } } }
  }
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
- Entries may declare `bodySchema` or `responseSchema` exactly like admin API registrations — seeded mocks enforce request body schemas and generate response bodies the same way, and an invalid schema (or a `body` + `responseSchema` combination) in the file stops the server like any other invalid entry.

### Request body schemas

A mock may declare an optional `bodySchema` — a JSON Schema (draft 2020-12) object describing the request bodies it accepts. Matching still selects the single winner by method + URI precedence; the winner's `bodySchema` then validates the request body, and a failing schema never falls through to a lower-precedence mock.

```bash
curl -X POST http://localhost:3000/_mocks \
  -H 'content-type: application/json' \
  -d '{"method": "POST", "uri": "/orders", "status": 201, "body": {"ok": true}, "bodySchema": {"type": "object", "required": ["name"], "properties": {"name": {"type": "string"}}}}'

curl -X POST http://localhost:3000/orders -d '{"name": 42}'   # 400
curl -X POST http://localhost:3000/orders -d '{"name": "widget"}'   # 201 {"ok": true}
```

- On validation failure the response is `400` with a JSON error listing every violation; `field` carries the JSON Schema instance path (empty string for the root):

  ```json
  {
    "error": {
      "message": "request body failed bodySchema validation",
      "method": "POST",
      "path": "/orders",
      "details": [{ "field": "/name", "message": "must be string" }]
    }
  }
  ```

- On success the registered response is served exactly as without a schema.
- An absent, empty, or non-JSON request body fails validation the same way (`400`) — a mock with `bodySchema` always expects a JSON body.
- Mocks **without** `bodySchema` never read the request body: existing mocks and traffic behave exactly as before.
- Schema-rejected calls still count in the call statistics as matched calls under the registered pattern.
- Schemas are self-contained: local `$ref` works, remote (HTTP) `$ref` resolution does not.

### Response generation from JSON Schema

A mock may declare an optional `responseSchema` — a JSON Schema describing the response body. Instead of a canned `body`, every matching call serves **freshly generated** fake data conforming to the schema:

```bash
curl -X POST http://localhost:3000/_mocks \
  -H 'content-type: application/json' \
  -d '{"method": "GET", "uri": "/users/:id", "responseSchema": {"type": "object", "required": ["id", "name"], "properties": {"id": {"type": "integer"}, "name": {"type": "string"}, "email": {"type": "string", "format": "email"}}}}'

curl http://localhost:3000/users/42   # {"id":254,"name":"aG88rL","email":"..."}
curl http://localhost:3000/users/42   # {"id":469,"name":"rH2xY","email":"..."} — different every call
```

- Each call generates independently — no seeding or caching knobs; tests must assert on shape (types, required fields), not on exact values.
- The mock's registered `status` and `headers` apply to generated responses; generated bodies are always JSON (`Content-Type: application/json` unless a registered header overrides). `HEAD` responses and null-body statuses (e.g. `204`) carry no body, as usual.
- `body` and `responseSchema` are mutually exclusive: a registration declaring both is rejected (`400` / config startup failure). `bodySchema` and `responseSchema` **do** combine: the request body is validated first (`400` on failure), then the response is generated.
- Supported drafts: JSON Schema 2019-09 and 2020-12 (a draft-04 `$schema` declaration is rejected at registration). Built-in `format` generators include `date-time`, `email`, `uri`, `uuid`, `ipv4`/`ipv6`; `pattern`, `enum`, `const`, `minimum`/`maximum`, `minItems`/`maxItems` etc. are honored.
- Optional properties appear with ~50% probability per call, and recursive `$ref` schemas are generated up to a depth limit — generated bodies vary in shape between calls by design.
- Invalid or unsatisfiable schemas are rejected at registration time via a trial generation, so a stored `responseSchema` always generates.

**Combining both features** — the shipped sample config seeds `POST /shipments` with a `bodySchema` (request contract: nested address, non-empty items array) *and* a `responseSchema` (generated receipt: uuid, enum status, date-time eta). The request body is validated first, then the response is generated:

```bash
curl -X POST http://localhost:3000/shipments -d '{"items": []}'
# 400 — details: /address "must have required property 'address'", /items "must NOT have fewer than 1 items"

curl -X POST http://localhost:3000/shipments \
  -d '{"address": {"city": "Warsaw", "zip": "00001"}, "items": [{"sku": "A-1", "qty": 2}]}'
# 201 — generated receipt, fresh every call, e.g.
# {"id":"0e1a...-uuid","status":"accepted","eta":"2026-09-26T17:03:12.345Z","courier":"xH2k"}
# ("courier" is optional in the schema, so it appears on roughly half the calls)
```

## Matching & precedence

- Matching is by exact HTTP method — strict, so a `HEAD` request only matches a `HEAD` mock (HEAD responses carry status and headers, never a body) — and by URI path. Query strings are ignored; a trailing slash is ignored (`/users` ≡ `/users/`).
- URI patterns: exact segments, `:param` (any single segment), and `*` (one or more remaining segments; only allowed as the final segment).
- When several mocks match one request, exactly one wins: **exact > `:param` > `*`**, compared segment by segment; identical patterns → the most recently registered mock wins.
- Unmatched requests get `500` with a JSON body naming method and path:

  ```json
  { "error": { "message": "no mock matches this request", "method": "GET", "path": "/unknown" } }
  ```

## Development

```bash
npm test             # unit + route-handler tests (vitest)
npm run build        # production build
npm run smoke        # E2E lifecycle check; requires a server on MOCK_BASE (default http://127.0.0.1:3100)
```

Layout: `lib/` holds the framework-agnostic core (matcher, SQLite-backed store, shared validation, request-body schema validation, schema-driven response generation, config loader, response assembly, in-memory call-statistics journal); `app/%5Fmocks/` is the admin API (Next.js requires the `%5F` folder escape to serve the literal `/_mocks` URL); `app/[[...slug]]/route.ts` is the catch-all mock handler; `instrumentation.ts` seeds the config at startup when the store is empty; `scripts/` holds the prestart config gate (`check-mocks.ts`, wired via `predev`/`prestart`) and the smoke test.
