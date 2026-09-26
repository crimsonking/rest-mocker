# Proposal

## Why

Every mock response today must be hand-written: an admin who wants a realistic `GET /users` payload has to invent and maintain the JSON themselves. When a team already has JSON Schemas for its API contracts, the mock server should be able to generate plausible response bodies from them directly — contract-first mocking with zero canned data. This complements the in-flight `add-mock-body-schema` change (which validates inbound request bodies); this one generates outbound response bodies.

## What Changes

- Mock definitions (admin API payload and `mocks.json` entries) gain an optional `responseSchema` field: a JSON Schema describing the response body.
- When a matched mock declares `responseSchema`, the server generates **fresh fake data per call** from the schema and serves it as the JSON response body. The mock's registered `status` and `headers` still apply; `HEAD` still omits the body.
- A registration carrying **both** `body` and `responseSchema` is rejected (`400` on the admin API, startup failure for config files) — user-confirmed decision, no silent precedence.
- An invalid or unsatisfiable `responseSchema` is rejected at registration time via a trial generation, like any other invalid field.
- `responseSchema` is persisted in the SQLite store and round-trips through restarts and `GET /_mocks` listings like every other field.
- New runtime dependency: `json-schema-faker` (schema-driven data generation).

## Capabilities

### New Capabilities

(none)

### Modified Capabilities

- `mock-routing`: new requirement — a matched mock with `responseSchema` serves a freshly generated JSON body per call instead of a registered body; status/headers/HEAD semantics unchanged.
- `mock-admin-api`: `POST /_mocks` accepts `responseSchema`, rejects invalid schemas and `body`+`responseSchema` combinations with `400`; `GET /_mocks` includes `responseSchema` in the listing.
- `mock-config`: config entries may carry `responseSchema`; invalid schemas or `body`+`responseSchema` entries fail startup with the existing fail-fast error.

`mock-store` requirements already persist "original ids and fields" generically; the column addition is an implementation detail covered in design.md, so no store delta is needed (same reasoning as `add-mock-body-schema`).

## Non-goals

- No determinism controls: no seeding, no per-mock stable data, no caching of generated values — every call generates fresh (user-confirmed).
- No request-body generation or request validation — that is `add-mock-body-schema`'s scope.
- No `format`-keyword customization beyond what `json-schema-faker` provides out of the box (e.g. `email`, `uuid`, `uri`).
- No generation for non-JSON response bodies (strings served as `text/plain` remain the static `body` feature).
- This change does not depend on `add-mock-body-schema` and vice versa; they may be implemented in either order.

## Impact

- Code: `lib/validation.ts` (new field + trial-generation check + `body`/`responseSchema` mutual exclusion), `lib/store.ts` (nullable `response_schema` column + idempotent `ALTER TABLE` migration), `lib/response.ts` (generation path in `buildMockResponse` or alongside it, listing projection), README.
- Dependencies: `json-schema-faker` added to `dependencies`.
- Compatibility: fully backward compatible — `responseSchema` is opt-in per mock; existing mocks, databases, and config files are untouched.
