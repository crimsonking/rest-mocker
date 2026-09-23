# Tasks

## 1. Scaffold & Tooling

- [x] 1.1 Scaffold a Next.js App Router application (TypeScript, strict mode, npm) in the repo root with no starter UI pages; verify `npm run build` succeeds and `npm run dev` answers requests on the default port
- [x] 1.2 Add vitest as a dev dependency with an `npm test` script and a placeholder spec under `lib/`; verify `npm test` runs and passes

## 2. Core Modules (lib/)

- [x] 2.1 Implement `lib/validation.ts` per design D5 (allowed method set with uppercase normalization, `uri` starts with `/` and not with `/_mocks`, `status` integer 100–599, `headers` string map, `body` any JSON value, field-level error messages); verify with unit tests that each rule accepts valid input and rejects each invalid shape with a message naming the field
- [x] 2.2 Implement `lib/store.ts` per design D3 (`MockRoute { id, method, uri, status, headers, body, seq }`, `crypto.randomUUID()` ids, monotonic `seq`, `globalThis` singleton, add/list/deleteById/clearAll); verify with unit tests covering registration-order listing, delete-by-id, clear-all, and singleton survival across a simulated module re-import
- [x] 2.3 Implement single-pattern matching in `lib/matcher.ts` (segment split, exact vs `:param` vs trailing `*` consuming ≥1 remaining segments, case-insensitive method compare); verify with unit tests for exact, param, and wildcard hits plus method-mismatch and segment-count misses
- [x] 2.4 Implement candidate selection and precedence in `lib/matcher.ts` per design D4 (trailing-slash normalization, segment scores exact 3 > param 2 > wildcard 1 compared left-to-right, highest `seq` wins identical patterns); verify with unit tests reproducing every `mock-routing` precedence scenario (exact beats param, param beats wildcard, latest registration wins)
- [x] 2.5 Implement response assembly in `lib/response.ts` per design D7 (registered status default 200, registered headers win, Content-Type defaults: JSON-serialized for non-string bodies, `text/plain` for strings) and the unmatched-request 404 JSON payload naming method and path; verify with unit tests for each default and override case
- [x] 2.6 Implement `lib/config.ts` (resolve `MOCK_CONFIG_FILE` env or default `mocks.json`, missing file yields empty list, parse JSON array, validate every entry through `lib/validation.ts`, preserve file order, actionable error naming file path and offending entry index); verify with unit tests using fixture files for valid config, malformed JSON, invalid entry, and missing file

## 3. Admin API (/_mocks)

- [x] 3.1 Implement `POST /_mocks` in `app/%5Fmocks/route.ts` (validate via D5, register in store, respond 201 with stored mock and `id`); verify with handler-level tests calling the exported function with `Request` objects: valid registration, re-registering the same route succeeds, and each invalid-payload case returns 400 with a JSON error and registers nothing
- [x] 3.2 Implement `GET /_mocks` in `app/%5Fmocks/route.ts` (200 JSON array with `id`, `method`, `uri`, `status`, `headers`, and `body`, oldest registration first); verify with handler-level tests for empty store, seeded order, and lossless `body` round-trip of a JSON-object body
- [x] 3.3 Implement `DELETE /_mocks` (clear-all, 204) and `DELETE /_mocks/{id}` in `app/%5Fmocks/[id]/route.ts` (204 on success, 404 JSON error on unknown id, store unchanged on error); verify with handler-level tests for each outcome

## 4. Catch-all Mock Handler

- [x] 4.1 Implement `app/[[...slug]]/route.ts` exporting all method handlers (GET/POST/PUT/PATCH/DELETE/HEAD/OPTIONS) with `runtime = 'nodejs'` and `dynamic = 'force-dynamic'`: strip query string, normalize trailing slash, consult store + matcher, build the response via `lib/response.ts`, and short-circuit any path under `/_mocks` so it never matches a stored mock; verify `npm run build` passes with the new route
- [x] 4.2 Add handler-level tests for the catch-all covering every `mock-routing` spec scenario: exact match, `:param` match, `*` wildcard match, method mismatch → 404, query string ignored, full pre-defined response (status/headers/body), default status 200, precedence trio, unmatched JSON 404 naming method and path, and `/_mocks` guard; verify all tests pass

## 5. Startup Seeding

- [x] 5.1 Wire seeding: `instrumentation.ts` `register()` (nodejs runtime guard) loads config via `lib/config.ts` into the store, add `scripts/check-mocks.ts` invoking the same loader and `predev`/`prestart` npm scripts running it; verify `npm run dev` with an invalid `mocks.json` exits before listening with an error naming the file and entry, and starts normally when the file is missing or valid
- [x] 5.2 Add a sample `mocks.json` with two demo mocks; verify against a started server that `GET /_mocks` lists them with ids, a matching request returns the seeded response, `DELETE /_mocks` clears them, and a restart restores them

## 6. Integration Verification & Docs

- [x] 6.1 Write and run an end-to-end smoke script against `npm run build && npm start` exercising the full lifecycle over real HTTP: register via POST, exact/param/wildcard matching, precedence override, query-string exclusion, delete-by-id, unmatched 404, clear-all, `/_mocks` never hitting the catch-all, and unsupported admin operations (`PUT /_mocks` and `GET /_mocks/{id}` → 405, unknown `/_mocks/a/b` → JSON 404); verify every step's status, headers, and body match the spec scenarios
- [x] 6.2 Write `README.md` covering quick start, admin API reference (all four endpoints with payloads), `mocks.json` format, `MOCK_CONFIG_FILE` env var, and matching/precedence rules; verify each documented command works as written from a clean checkout
- [ ] 6.3 Run the full gate: `npm test`, `npm run build`, and the 6.1 smoke script; verify all pass with no type errors, and commit history follows conventional commits
