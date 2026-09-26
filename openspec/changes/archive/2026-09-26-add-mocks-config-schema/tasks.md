# Tasks

## 1. Schema file

- [x] 1.1 Write `mocks.schema.json` (draft 2020-12): `$defs.entry` with `method` (7-method enum, required), `uri` (string `^/`, required), `status` (integer 100–599), `headers` (object, string values), `body` (free-form), `bodySchema`/`responseSchema` (`{type: object}`) with entry-level exclusion of `body`+`responseSchema` (`not: {required: [body, responseSchema]}`), `additionalProperties: false`; root `oneOf: [ {array of $defs.entry}, {wrapper: $schema string optional, mocks array of $defs.entry required, additionalProperties: false} ]`; a `$comment` noting `validateMockDefinition` is the runtime authority; verify it compiles: `node -e "import('ajv/dist/2020.js').then(({default:A})=>{new A({strict:false}).compile(require('./mocks.schema.json'));console.log('schema compiles')})"`
- [x] 1.2 Add `lib/config-schema.test.ts` (drift guard, reuses ajv): shipped `mocks.json` validates; a minimal bare-array sample validates; a wrapper sample validates; `{"mocks": [], "extra": 1}` and an entry with `body`+`responseSchema` are rejected; verify `npx vitest run lib/config-schema.test.ts` passes

## 2. Loader wrapper support

- [x] 2.1 `lib/config.ts` — in `readConfigEntries`, replace the not-an-array rejection with a form fork: `Array.isArray(parsed)` → entries as today; plain non-null object → keys must be a subset of `{$schema, mocks}` with `mocks` an array (else ConfigError naming the file and the offending key), `$schema` (when present) must be a string and is otherwise ignored; entries from `parsed.mocks` flow through the same `validateMockDefinition` map with unchanged entry-index errors; anything else → ConfigError naming both accepted forms; verify `npx tsc --noEmit` shows no new errors
- [x] 2.2 Extend `lib/config.test.ts`: wrapper seeds identically to array (same entries, same order, same skip-when-nonempty); unknown wrapper key throws naming the file and key; non-array `mocks` throws; non-string `$schema` throws; unreachable-`$schema`-path config with valid entries loads fine; invalid entry inside wrapper names file and entry index; bare array behavior unchanged (existing tests stay green); verify `npx vitest run lib/config.test.ts` passes

## 3. Sample config and docs

- [x] 3.1 Convert `mocks.json` to wrapper form (`"$schema": "./mocks.schema.json"`, same five entries under `mocks`); verify `node scripts/check-mocks.ts` prints `config OK` with 5 definitions and the drift-guard test (1.2) still passes against the converted file
- [x] 3.2 Check the Dockerfile's copy steps: if it copies `mocks.json` explicitly, add `mocks.schema.json` next to it; if it copies the whole context, no change; verify `docker build` is not broken by the new root file (build or, at minimum, confirm the COPY list)
- [x] 3.3 README: document both config forms in the `At startup — mocks.json` section (wrapper example with `$schema`, note that bare arrays remain valid, note that `$schema` is editor-only and never fetched at runtime), and mention `mocks.schema.json` in the layout paragraph; verify the documented wrapper example passes `node scripts/check-mocks.ts` when saved to a temp file with `MOCK_CONFIG_FILE`

## 4. Full gates

- [x] 4.1 `npm test`, `npm run build`, `node scripts/check-mocks.ts` all exit 0; against a dev server with the wrapper-form sample, `curl /health` returns the seeded response and `POST /shipments` with a bad body returns `400` (wrapper seeding reaches both schema features)
