# Tasks

## 1. Dependency and generation core

- [x] 1.1 Add `json-schema-faker` to `dependencies` (`npm install json-schema-faker`); verify under plain Node: `node -e "import('json-schema-faker').then(m => console.log(m.generateSync({type:'string'})))"` prints a string
- [x] 1.2 Create `lib/body-gen.ts`: `getGenerator()` returning a `createGeneratorSync()` singleton kept on `globalThis` (HMR-surviving, like the store), and `generateFromSchema(schema: Json): Json` calling it with `{ failOnInvalidTypes: true }` and a `// ponytail:` note that per-call generation is uncached (cache per mock id if profiling ever matters)
- [x] 1.3 Write `lib/body-gen.test.ts`: object schema with required integer/string fields yields correct types; two consecutive calls both conform; `{"type":"nope"}` throws; unsupported `$schema` value throws; verify `npx vitest run lib/body-gen.test.ts` passes
- [x] 1.4 Extend `MockDefinition` and `validateMockDefinition` (lib/validation.ts): optional `responseSchema?: Json` — must be a JSON object, one trial `generateFromSchema` must succeed (error message includes the library's reason), and a definition carrying both `body` and `responseSchema` is rejected naming both fields; extend `lib/validation.test.ts` with accept/reject/conflict cases; verify `npx vitest run lib/validation.test.ts` passes

## 2. Store persistence and migration

- [x] 2.1 Add `responseSchema?: Json` to `MockRoute`, `response_schema TEXT NULL` to `SCHEMA_SQL`, and after `CREATE TABLE IF NOT EXISTS` run `PRAGMA table_info(mocks)` + `ALTER TABLE mocks ADD COLUMN response_schema TEXT NULL` when absent (lib/store.ts); round-trip through `add`/`list` (SQL NULL = not declared)
- [x] 2.2 Extend `lib/store.test.ts`: a mock stored with `responseSchema` survives close/reopen intact; a mock without it lists with `responseSchema` undefined; opening a pre-migration database (column absent, one row inserted) succeeds and the old row lists with `responseSchema` undefined; verify `npx vitest run lib/store.test.ts` passes

## 3. Response projection and admin API

- [x] 3.1 Extend `MockJson`/`toMockJson` (lib/response.ts) to project `responseSchema` only when present; extend `lib/response.test.ts`; verify `npx vitest run lib/response.test.ts` passes
- [x] 3.2 Extend `app/%5Fmocks/route.test.ts` (no route code changes expected — validation already covers the field): POST with valid `responseSchema` → `201` including it; POST with `{"type":"nope"}` schema → `400` naming `responseSchema`, nothing registered; POST with both `body` and `responseSchema` → `400` naming the conflict, nothing registered; `GET /_mocks` includes `responseSchema` for declaring mocks and omits it for others; verify `npx vitest run "app/%5Fmocks/route.test.ts"` passes

## 4. Request-time generation

- [x] 4.1 In `app/[[...slug]]/route.ts`: after `findMatchingMock` and the matched stats record, when the winner has `responseSchema` and the method is not `HEAD`, call `generateFromSchema` inside a try/catch (throw → `500` JSON error naming the mock id, per design D28) and serve `buildMockResponse({ ...mock, body: generated })`; mocks without `responseSchema` take the existing untouched path; verify `npx tsc --noEmit` is clean
- [x] 4.2 Add handler tests (follow the test harness pattern used by `app/%5Fmocks/route.test.ts`): generated body conforms to the schema (required fields present, types correct, `Content-Type: application/json`); two calls each return conforming bodies; registered status `201` and custom header apply; `HEAD` returns status/headers with no body; `204` status omits the body; static-`body` mock without schema serves unchanged; verify `npx vitest run` passes for the new file

## 5. Config surface

- [x] 5.1 Extend `lib/config.test.ts`: an entry with a valid `responseSchema` loads and seeds intact; an entry with `{"type":"nope"}` throws `ConfigError` naming file and entry index; an entry with both `body` and `responseSchema` throws likewise (no loader changes expected — rules live in `validateMockDefinition`); verify `npx vitest run lib/config.test.ts` passes
- [x] 5.2 Add a `responseSchema` example entry to the sample `mocks.json` and verify `node scripts/check-mocks.ts` prints `config OK`

## 6. Docs and full verification

- [x] 6.1 Update README: `responseSchema` row in the `POST /_mocks` field table (noting mutual exclusion with `body`), a "Response generation from JSON Schema" subsection (fresh data per call, draft 2019-09/2020-12 support, optional properties vary per call, recursion depth limit, generated responses are always JSON), and mention in the mocks.json section; verify the documented example matches the implemented behavior
- [x] 6.2 Run the full gates: `npm test`, `npm run build`, `node scripts/check-mocks.ts` — all exit 0; against a dev server, register a `responseSchema` mock via `POST /_mocks` and verify two `curl` calls return `200` with conforming, independently generated bodies
