# Proposal

## Why

Mocks currently match on method + URI only. Tests that exercise input validation cannot use this server to distinguish a well-formed request from a malformed one — every matching request gets the same canned response. Letting each mock declare a JSON Schema for its request body makes the mock server able to reject invalid payloads the way the real API would, so E2E tests can cover negative paths without a real backend.

## What Changes

- Mock definitions (admin API payload and `mocks.json` entries) gain an optional `bodySchema` field: a JSON Schema (draft 2020-12) object describing the expected request body.
- `bodySchema` itself is validated at registration time; an invalid schema is rejected like any other invalid field (admin API `400`, config file fails startup).
- When a request matches a mock that declares `bodySchema`, the server parses the request body as JSON and validates it against the schema. On failure the server responds `400` with a JSON error carrying per-violation details (instance path + message) instead of the mock's canned response. A missing or non-JSON body on such a mock is also a `400`.
- Mocks without `bodySchema` behave exactly as today (no body reading, no new failure modes).
- `bodySchema` is persisted in the SQLite store, listed by `GET /_mocks`, and round-trips through restarts like every other field.
- New runtime dependency: `ajv` (JSON Schema validator/compiler).

## Capabilities

### New Capabilities

(none)

### Modified Capabilities

- `mock-routing`: new requirement — after a method+URI match, a mock with `bodySchema` validates the request body; failures yield a `400` JSON error with details, successes yield the registered response unchanged.
- `mock-admin-api`: `POST /_mocks` accepts and validates the optional `bodySchema` field (rejecting invalid schemas with `400`); `GET /_mocks` includes `bodySchema` in the listing.
- `mock-config`: config file entries may carry `bodySchema`; an entry with an invalid schema fails startup with the existing fail-fast error naming file and entry.

`mock-store` requirements already persist "original ids and fields" generically; the column addition is an implementation detail covered in design.md, so no store delta is needed.

## Non-goals

- No schema-based matching/precedence: method+URI still selects the single winner; a body-schema failure never falls through to a lower-precedence mock.
- No validation of query parameters, headers, or path params — request bodies only.
- No JSON Schema for response bodies, and no generated schema file for `mocks.json` itself.
- No support for non-JSON request bodies (form data, multipart) — a non-JSON body against a `bodySchema` mock is simply a `400`.
- No custom schema dialects or `$ref` resolution against remote documents (local, self-contained schemas only).

## Impact

- Code: `lib/types.ts` / `lib/validation.ts` (field + schema validation), `lib/store.ts` (new nullable column + one-time `ALTER TABLE` migration for existing databases), `lib/response.ts` (400 error shape + listing projection), `app/[[...slug]]/route.ts` (validate body after match), README.
- Dependencies: `ajv` added to `dependencies`.
- Compatibility: fully backward compatible — existing mocks, databases, and config files work unchanged; `bodySchema` is opt-in per mock.
