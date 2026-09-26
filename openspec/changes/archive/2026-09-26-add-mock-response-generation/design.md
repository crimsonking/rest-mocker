# Design

## Context

See proposal.md — Why. Current state relevant to the approach:

- `validateMockDefinition` (lib/validation.ts) is the single validation surface shared by the admin API and config loader (design D5); new field rules go there.
- `buildMockResponse` (lib/response.ts) already implements header precedence, Content-Type defaulting (non-string bodies → `application/json`), HEAD omission, and null-body statuses (design D7). A generated body is just another non-string body.
- The store (lib/store.ts) keeps one SQLite table with JSON text columns and creates its schema with `CREATE TABLE IF NOT EXISTS`; existing databases must keep working.
- The sibling change `add-mock-body-schema` (in flight, not yet applied) reserves decisions D22–D26 and touches the same three modules for an independent feature. Numbering here continues from D27; the two changes are archive/apply-order independent (see D31).

## Goals / Non-Goals

**Goals:**

- `responseSchema` on a mock definition; every matched call serves a freshly generated conforming JSON body (user-confirmed: fresh per call, no determinism controls).
- Invalid, unsatisfiable, or `body`-conflicting schemas rejected once, at registration/startup — they never reach the store.
- Zero changes to response assembly and matching: generation feeds the existing pipeline.

**Non-Goals:**

- No seeding/stability knobs, no custom formats, no faker/chance extensions (see proposal Non-goals).
- No remote `$ref` resolution; schemas are self-contained (local `$ref` is handled by the generator's built-in cycle detection).

## Decisions

### D27 — Generator: `json-schema-faker` v0.6.x via a `createGeneratorSync` singleton

New runtime dependency `json-schema-faker` (zero production dependencies of its own; supports JSON Schema 2019-09/2020-12, composition keywords, `$ref` with cycle detection, built-in formats, AST-based `pattern` strings). Use `createGeneratorSync()` kept on `globalThis` like the store singleton (dev-mode HMR survives): it **auto-increments its seed per call**, which is exactly the fresh-data-per-call semantics. The plain `generateSync(schema)` API is rejected for the request path: it defaults to `seed: 1` and would return byte-identical data on every call. Sync variant is safe here because schemas are always in-memory (no I/O resolvers). Alternative considered: `@faker-js/faker` plus a hand-written schema walker — rejected, that is reimplementing a maintained library.

### D28 — Schema validation at registration: trial generation, strict options

New module `lib/body-gen.ts` exposes `generateFromSchema(schema: Json): Json` and wraps the singleton generator with `{ failOnInvalidTypes: true }` so junk like `{"type": "nope"}` **throws** instead of silently substituting defaults (the library default `failOnInvalidTypes: false` would accept it). `validateMockDefinition` gains a `responseSchema` branch: must be a JSON object, and one trial `generateFromSchema` call must succeed; failures produce `{ field: 'responseSchema', message }` — including the library's error for unsupported `$schema` versions. Mutual exclusion: a definition carrying both `body` and `responseSchema` is rejected with a message naming both fields (user-confirmed decision). A passed trial is not a proof every future generation succeeds (exotic `pattern`/recursion edges), so the request path also wraps generation: on throw, respond `500` with a JSON error naming the mock id — rare and actionable, deliberately not specced.

### D29 — Response assembly: feed the existing pipeline, change nothing in it

The catch-all handler, after `findMatchingMock` and the matched stats record: if the winner has `responseSchema` and the method is not `HEAD`, generate the value and call `buildMockResponse({ ...mock, body: generated })`. Content-Type defaulting, registered-header precedence, null-body statuses, and HEAD omission all come for free from D7; the `HEAD` check only avoids wasted generation. Mocks without `responseSchema` take the byte-identical existing path. Alternative: teaching `buildMockResponse` about schemas — rejected, it would couple response assembly to the generator for zero behavior gain.

### D30 — Storage: nullable `response_schema` TEXT column, in-place idempotent migration

Same pattern as the sibling change's D25: `MockRoute` gains `responseSchema?: Json`; after `CREATE TABLE IF NOT EXISTS`, run `PRAGMA table_info(mocks)` and `ALTER TABLE mocks ADD COLUMN response_schema TEXT NULL` when absent. A schema is always an object when present, so SQL NULL unambiguously means "not declared". `toMockJson` projects `responseSchema` only when present, same as `body`.

### D31 — Change independence: ADDED-only deltas, additive-only code

All spec deltas in this change use ADDED requirements (no MODIFIED blocks), and all code touchpoints are additive (new validation branch, new column, new handler branch). `add-mock-body-schema` MODIFIES several of the same requirements; with ADDED-only deltas here, the two changes archive cleanly in either order with no spec reconciliation, and whichever is applied second simply adds its branch/column alongside the first's.

## Risks / Trade-offs

- [`json-schema-faker` 0.6.x is a recent TypeScript rewrite aimed at "Node-like or Bun" environments] → Task 1.1 verifies the import and a trial generation under plain Node before anything else is built; Next.js route handlers run on Node (`runtime = 'nodejs'` already set).
- [AST-based `pattern` generation can produce non-conforming strings for exotic regexes] → Trial generation at registration catches most cases; remaining edges surface as conform-or-500 at request time, documented as a known limitation.
- [Recursive `$ref` schemas truncate at `maxDepth` (default 5)] → Library default kept; documented, no knob exposed (non-goal).
- [Optional properties appear with probability 0.5 per call (`optionalsProbability` default)] → Matches the "fresh data" intent; documented in README so test authors know generated bodies vary in shape.
- [Generation cost per request] → Test-scale traffic; sync in-memory generation is microseconds-to-milliseconds for typical schemas. `// ponytail:` note in code — cache per mock id if profiling ever shows otherwise.

## Migration Plan

1. Add `json-schema-faker`; ship the column migration (automatic, first open after upgrade).
2. No backfill: existing rows get `response_schema = NULL` and behave exactly as before.
3. Rollback: previous versions select explicit columns and ignore `response_schema`; declarations become inert.
