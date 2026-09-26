# Proposal

## Why

The smoke suite (`npm run smoke`, `scripts/smoke.mjs`) is the container-level E2E gate — the README bills it as checking "the full lifecycle" against a running server, and it is the only verification that exercises the production Next.js standalone bundle. Both schema features shipped today (`bodySchema` request validation, `responseSchema` response generation) have thorough in-process vitest coverage but **zero** smoke coverage: the Docker/production path — ajv and json-schema-faker inside the bundled runtime, SQLite column migration on a real database file, admin-API registration followed by catch-all enforcement over HTTP — has never been exercised end to end.

## What Changes

- Extend `scripts/smoke.mjs` with a schema-features section (~8 new checks) running against the same live server the rest of the suite uses:
  - Register a `bodySchema` mock → bad body gets `400` with `details[0].field === '/name'`; absent body gets `400`; good body gets the canned response; the store count is unchanged after rejections.
  - Register a `responseSchema` mock → two calls return `200` `application/json`, both bodies conform (required fields, correct types), and the two bodies differ (fresh-per-call).
  - Invalid schema registrations (`{"type":"nope"}` as `bodySchema` / `responseSchema`) get `400` naming the field; a `body` + `responseSchema` payload gets `400` matching `/cannot be combined/`.
- No server behavior changes, no dependency changes.

## Capabilities

### New Capabilities

(none)

### Modified Capabilities

(none — this change verifies behavior already specified in `mock-routing` and `mock-admin-api`; no spec-level behavior changes, so the change declares `skip_specs: true`.)

## Non-goals

- No new server features and no spec changes.
- No duplication of the vitest matrix — smoke keeps container-level happy + rejection paths only, roughly one check per documented guarantee.
- No CI pipeline changes; the suite stays manually invoked via `MOCK_BASE`, as today.

## Impact

- `scripts/smoke.mjs` only. Gate: `npm run smoke` passes against a locally built production server (`npm run build` + `npm start` on a temp database), and remains valid for the Docker image flow it was written for.
