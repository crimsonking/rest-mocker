# Tasks

## 1. Dependency and shared validation

- [x] 1.1 Add `ajv` to `dependencies` (`npm install ajv`); verify `node -e "import('ajv/dist/2020').then(m => new m.default({strict:false}))"` runs without error (note: plain Node ESM requires the `.js` extension — `ajv/dist/2020.js`; verified OK)
- [x] 1.2 Extend `MockDefinition` (lib/validation.ts) with optional `bodySchema?: Json`; verify `npx tsc --noEmit` is clean
- [x] 1.3 Create `lib/body-schema.ts`: module-level `Ajv2020` singleton (`strict: false`, `allErrors: true`, `allowUnionTypes: true`), `compileBodySchema(schema: unknown)` returning a validation error message or null (used at registration), and `validateBody(schemaJson: Json, bodyText: string | null)` returning `null` on success or `{ field: instancePath, message }[]` (empty/absent/unparseable body → single root-level error; compiled validators cached in a `Map` keyed by `JSON.stringify(schema)`, kept alive on `globalThis` like the store, with a `// ponytail:` note that the cache is unbounded until clearAll matters)
- [x] 1.4 Write `lib/body-schema.test.ts` covering: valid body passes; wrong-type body yields details with instance path (`/name`); missing `required` field reported; empty body and malformed JSON body each yield a root-level error; invalid schema (`{"type":"nope"}`) rejected by `compileBodySchema`; same schema compiled once (cache hit); verify `npx vitest run lib/body-schema.test.ts` passes
- [x] 1.5 Add a `bodySchema` branch to `validateMockDefinition` (lib/validation.ts): must be a JSON object and pass `compileBodySchema`; on failure push `{ field: 'bodySchema', message }`; extend `lib/validation.test.ts` with accept/reject cases; verify `npx vitest run lib/validation.test.ts` passes

## 2. Store persistence and migration

- [x] 2.1 Add `bodySchema?: Json` to `MockRoute`, `body_schema TEXT NULL` to `SCHEMA_SQL`, and after `CREATE TABLE IF NOT EXISTS` run `PRAGMA table_info(mocks)` + `ALTER TABLE mocks ADD COLUMN body_schema TEXT NULL` when absent (lib/store.ts); round-trip through `add`/`list` with the same NULL-vs-`'null'` discipline as `body` (D9)
- [x] 2.2 Extend `lib/store.test.ts`: a mock stored with `bodySchema` survives close/reopen with the schema intact; a mock without it lists with `bodySchema` undefined; opening a database created by the pre-migration schema (create table without the column, insert a row, reopen) succeeds and the old row lists with `bodySchema` undefined; verify `npx vitest run lib/store.test.ts` passes

## 3. Response assembly and admin API

- [x] 3.1 Extend `MockJson`/`toMockJson` (lib/response.ts) to project `bodySchema` only when present, and add a `bodySchemaRejectionResponse(method, path, details)` helper producing `400` with `{ error: { message, method, path, details } }`; extend `lib/response.test.ts`; verify `npx vitest run lib/response.test.ts` passes
- [x] 3.2 Wire the admin API: no route changes expected beyond `validateMockDefinition` already covering `bodySchema` — extend `app/%5Fmocks/route.test.ts` with: POST with valid `bodySchema` → `201` including it; POST with `{"type":"nope"}` schema → `400` naming `bodySchema`, nothing registered; `GET /_mocks` includes `bodySchema`; verify `npx vitest run "app/%5Fmocks/route.test.ts"` passes

## 4. Request-time enforcement

- [x] 4.1 In `app/[[...slug]]/route.ts`: after `findMatchingMock` and the matched stats record, when the winner has `bodySchema`, read `await req.text()`, call `validateBody`, and on failure return `bodySchemaRejectionResponse`; on success fall through to `buildMockResponse` unchanged; mocks without `bodySchema` never read the body; verify `npx tsc --noEmit` is clean
- [x] 4.2 Add handler tests (new `app/[[...slug]]/route.test.ts` or extend the existing lib-level test harness pattern used by `app/%5Fmocks/route.test.ts`): valid body → registered response; invalid body → `400` with details naming the instance path; empty and non-JSON bodies → `400`; schema rejection does not fall through to a registered wildcard mock; rejected call journaled with `matched: true` under the pattern; schema-less mock serves a malformed-body request unchanged; verify `npx vitest run` passes for the new file

## 5. Config surface

- [x] 5.1 Extend `lib/config.test.ts`: a config entry with a valid `bodySchema` loads and seeds intact; an entry with `{"type":"nope"}` throws `ConfigError` naming the file and entry index (no loader code changes expected per D26 — if any are needed, keep them inside `validateMockDefinition`); verify `npx vitest run lib/config.test.ts` passes
- [x] 5.2 Add a `bodySchema` example entry to the sample `mocks.json` and verify `node scripts/check-mocks.ts` prints `config OK`

## 6. Docs and full verification

- [x] 6.1 Update README: `bodySchema` row in the `POST /_mocks` field table, a "Request body schemas" subsection under Defining mocks (semantics: winner-takes-all then validate, `400` + details shape, absent/non-JSON body rejected, schema-less mocks untouched), and mention `bodySchema` in the mocks.json section; verify the documented `400` example matches the implemented error shape
- [x] 6.2 Run the full gates: `npm test`, `npm run build`, and `node scripts/check-mocks.ts` — all exit 0; verify against a dev server that a registered `bodySchema` mock returns `400` for a bad body and the canned response for a good one (curl, or `npm run smoke` if the container flow is available)
