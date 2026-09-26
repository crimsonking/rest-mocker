# Design

## Context

See proposal.md — Why. Current state relevant to the approach:

- `validateMockDefinition` (lib/validation.ts) is the single validation surface shared by the admin API and the config loader (design D5); new field rules go there.
- The catch-all handler (app/[[...slug]]/route.ts) never reads the request body today; `findMatchingMock` picks exactly one winner by method + URI precedence.
- The store (lib/store.ts) keeps one SQLite table with JSON text columns; an absent value is SQL NULL, a JSON literal `null` is the text `'null'` (design D9). Existing databases are in the wild and must keep working.
- Decision numbering continues from D21.

## Goals / Non-Goals

**Goals:**

- `bodySchema` on a mock definition, enforced at request time with a `400` + per-violation details on failure (user-chosen semantics: no fall-through).
- Schema correctness checked once, at registration/startup — an invalid schema never reaches the store.
- Existing databases migrate in place, with no manual steps.

**Non-Goals:**

- Schema-based matching or precedence changes (see proposal Non-goals).
- Validating anything other than the request body.
- Remote `$ref` resolution; schemas are self-contained documents (local `$ref`s within the schema are fine — ajv handles them).

## Decisions

### D22 — Field name and validation entry point: `bodySchema`, validated in `validateMockDefinition`

Optional field `bodySchema?: Json` on `MockDefinition`. Validation follows the existing shared-surface pattern (D5): `validateMockDefinition` gains a `bodySchema` branch that requires a JSON object and compiles it (see D23) to prove it is a valid schema; failures produce `{ field: 'bodySchema', message: ... }` like every other field. Both the admin API and the config loader inherit the rule for free. Alternative: validating only in the admin route — rejected, it would let a bad schema in via `mocks.json` and drift between surfaces, exactly what D5 exists to prevent.

### D23 — Validator: `ajv` (draft 2020-12), non-strict mode

New runtime dependency `ajv`; use `Ajv2020` from `ajv/dist/2020`. Rationale: JSON Schema validation is a solved, spec-heavy problem — hand-rolling even the common keywords is a correctness trap, and ajv is the de-facto standard. Configured with `strict: false`, `allErrors: true`, `allowUnionTypes: true`: user-supplied schemas must not be rejected for ajv's strict-mode stylistic preferences, and `allErrors` fills the `details` list. A module-level singleton Ajv instance plus a `Map<string, ValidateFunction>` keyed by `JSON.stringify(schema)` compiles each distinct schema once per process (dev-mode HMR keeps it alive on `globalThis`, like the store). Alternative considered: `zod` — rejected, it is not a JSON Schema implementation and would need a translation layer.

### D24 — Request-time semantics: winner-takes-all, then validate

After `findMatchingMock` selects the winner, if — and only if — it declares `bodySchema`: read the body text; empty/absent body or a JSON parse failure is a `400`; otherwise validate the parsed value. Failure → `400`, success → `buildMockResponse` unchanged. Mocks without `bodySchema` never touch `req.body`, preserving today's zero-body-read behavior. The call is journaled via `getStats().record({ matched: true, ... })` before validation, so schema-rejected calls count under the registered pattern as the spec requires. Error shape reuses the established `{ error: { message, details: [{ field, message }] } }` form, with `field` carrying the JSON Schema instance path (e.g. `/name`, `` for the root) and `method`/`path` added like the unmatched-404 body. Alternative: skip-to-next-mock on failure — rejected by explicit user decision.

### D25 — Storage: nullable `body_schema` TEXT column, in-place idempotent migration

`MockRoute` and the table gain `bodySchema` / `body_schema TEXT NULL`, with the same NULL-vs-`'null'` discipline as `body` (D9). Migration on open: after `CREATE TABLE IF NOT EXISTS`, run `PRAGMA table_info(mocks)`; if `body_schema` is absent, `ALTER TABLE mocks ADD COLUMN body_schema TEXT NULL`. Idempotent, single-process ownership already assumed, no version table needed for one additive column. Alternative considered: storing the schema inside the `headers`-style JSON blob or a second table — rejected, a column mirrors how `body` is already handled. `toMockJson` projects `bodySchema` only when present, same as `body`.

### D26 — Config surface: no loader changes beyond validation

`readConfigEntries` and the prestart gate (check-mocks.ts) need no new code paths: they already funnel through `validateMockDefinition` (D22) and report entry-index errors, so an invalid `bodySchema` in `mocks.json` fails startup with the existing message format.

## Risks / Trade-offs

- [A user schema uses a keyword ajv's 2020 build rejects at compile time] → Compile-at-registration turns it into an immediate `400`/startup error naming `bodySchema`, never a runtime surprise; `strict: false` already tolerates unknown keywords.
- [Compilation cache grows with many distinct schemas] → Mock counts are test-scale; the Map is bounded in practice. `// ponytail:` note in code: clear-on-clearAll if it ever matters.
- [Reading request bodies adds buffering on schema mocks] → Only mocks that opt in pay the cost; opt-out (no `bodySchema`) path is byte-identical to today.
- [Large request bodies against a schema mock] → No size limit added; consistent with the server's existing trust model (a test tool, not a public endpoint).
- [Old server versions opening a migrated database] → Old code selects explicit columns and ignores `body_schema`; forward-compatible.

## Migration Plan

1. Add `ajv` dependency; ship column migration (automatic, first open after upgrade).
2. No data backfill: existing mocks get `body_schema = NULL` and behave exactly as before.
3. Rollback: previous version keeps working against the migrated database (extra column ignored); `bodySchema` declarations become inert.
