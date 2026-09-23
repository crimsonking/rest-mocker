# Design

## Context

Greenfield repo; motivation in proposal.md — Why, behavior contracts in `specs/mock-routing`, `specs/mock-admin-api`, `specs/mock-config`. Constraints from project config: TypeScript, Node.js, Next.js (App Router); no other stack pinned. The server must answer on **arbitrary URIs** (not a fixed route table) while keeping `/_mocks` for the admin API — the framework's routing must bend to that, which drives most decisions below.

## Goals / Non-Goals

**Goals:**
- All three capabilities in one Next.js application, zero runtime dependencies beyond the framework.
- Matching, validation, and store logic live in pure framework-agnostic modules (`lib/`), unit-testable without booting Next.js.
- Deterministic behavior per the spec precedence rules, independent of registration history surprises.

**Non-Goals:**
- Dashboard/UI, persistence, multi-process clustering, HTTPS (see proposal Non-goals).
- Handling high request volume — this is a local dev tool; linear scan over registered mocks is fine.

## Decisions

### D1: Next.js App Router route handlers, no extra HTTP framework
A single optional catch-all handler `app/[[...slug]]/route.ts` exports all methods (GET/POST/PUT/PATCH/DELETE/HEAD/OPTIONS) and serves every mocked URI including `/`. Next's route specificity (static > dynamic > catch-all) lets the admin routes win over the catch-all automatically. Handlers run with `runtime = 'nodejs'` and `dynamic = 'force-dynamic'` so nothing is cached or prerendered.
*Alternative:* plain Node `http`/Express server — simpler mental model, but the project context pins Next.js and route handlers cover everything needed.

### D2: `/_mocks` admin routes via `%5F` folder escape
App Router treats `_`-prefixed folders as private (excluded from routing), so the admin routes live in `app/%5Fmocks/route.ts` and `app/%5Fmocks/[id]/route.ts`, which Next serves at URL path `/_mocks`. Endpoint mapping: `GET /_mocks` list, `POST /_mocks` register, `DELETE /_mocks` clear-all, `DELETE /_mocks/{id}` delete-one.
*Alternative:* intercept `/_mocks` in `middleware.ts` — workable fallback if the escape misbehaves, but keeps logic out of route handlers; held as contingency, not first choice.

### D3: In-memory store as a `globalThis` singleton
`lib/store.ts` holds `MockRoute { id, method, uri, status, headers, body, seq }`; `id = crypto.randomUUID()`, `seq` a monotonically increasing registration counter used for precedence tie-breaks and list ordering. The singleton is attached to `globalThis` so dev-mode HMR recompiles don't wipe runtime-registered mocks. Single Node process; no locking needed.

### D4: Segment-score matcher in pure module
`lib/matcher.ts`: split pattern and request path into segments (trailing slash stripped before comparison, so `/health/` matches `/health`; query string never reaches the matcher). Segment scores: exact `3` > `:param` `2` > `*` `1`. `*` is valid only as the final segment and consumes all remaining segments (≥1). Among mocks whose method matches (case-insensitive, normalized to uppercase; allowed set: GET, POST, PUT, PATCH, DELETE, HEAD, OPTIONS), compare matching patterns segment-by-segment, highest score at the first difference wins; identical patterns → highest `seq` wins. Linear scan, no trie, no path-to-regexp.
*Alternative:* `path-to-regexp` — extra dependency whose semantics we'd still constrain to the spec; rejected.

### D5: One validator shared by admin API and config loader
`lib/validation.ts` implements the payload rules both surfaces need (method in allowed set, `uri` starts with `/` and not with `/_mocks`, `status` integer 100–599, `headers` string map, `body` any JSON value), returning field-level error messages. `POST /_mocks` answers 400 with them; the config loader uses them for fail-fast startup errors naming file + entry index.

### D6: Startup seeding via instrumentation hook, guarded by a prestart check
`instrumentation.ts` `register()` (nodejs runtime only) calls `lib/config.ts`: resolve path from `MOCK_CONFIG_FILE` env or default `mocks.json`; missing file → empty store; present file → parse, validate every entry via D5, seed in file order. On invalid config it throws with file path + offending entry, which aborts Next startup. Because `register()`'s failure semantics can vary across Next versions, the same loader also runs in `predev`/`prestart` npm scripts so an invalid config reliably stops the process before it listens.

### D7: Body storage and delivery round-trip
`body` is stored as the registered JSON value. Delivery: registered `Content-Type` header wins; otherwise object/array/number/boolean/null bodies serialize via `JSON.stringify` with `application/json`, string bodies go out as-is with `text/plain`. List/get return the stored value unchanged, so register→list round-trips are lossless.

## Recorded Assumptions

Spec-silent edge cases, pinned here as design assumptions (advisory review 2026-09-23):

- **Unsupported admin operations**: a method not exported by an existing admin route (`PUT /_mocks`, `GET /_mocks/{id}`) returns `405 Method Not Allowed` — the App Router default for route handlers. Unknown subpaths under the reserved prefix (`/_mocks/a/b`) fall to the catch-all, whose reserved-prefix short-circuit returns the same JSON `404` as unmatched traffic; they never match a stored mock.
- **Trailing slash**: `/users` and `/users/` are equivalent — normalization strips trailing slashes before matching (D4); the root `/` is unaffected.
- **HEAD requests**: strict method matching — a HEAD request matches only a HEAD-registered mock; there is no implicit GET→HEAD fallback. HEAD responses carry the mock's status and headers with an empty body, per HTTP semantics.

## Risks / Trade-offs

- [`%5F` escape is obscure and version-sensitive] → integration test asserts `/_mocks` reaches the admin handler and never the catch-all; fallback is a middleware rewrite (D2 alternative).
- [`register()` throw might not prevent listening in some Next versions] → D6's prestart/predev script runs the identical loader, so invalid config fails before `next start`/`next dev` launches.
- [Dev HMR resets module state] → `globalThis` singleton (D3); integration tests run against `next build && next start` for determinism.
- [Catch-all also swallows `/_next/*` and any static asset requests] → acceptable for an API-only tool: everything unmatched gets the JSON 404; no UI is served.
- [Linear-scan matching is O(mocks)] → mock counts are small (dozens); revisit only if that assumption breaks.

## Migration Plan

Not applicable — first change in the repo, nothing deployed to migrate or roll back.
