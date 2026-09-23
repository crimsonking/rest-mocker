# Tasks

## 1. SQLite-backed store

- [x] 1.1 Add `mocks.db*` to `.gitignore`. Verify: after `touch mocks.db mocks.db-journal`, `git status --porcelain` shows neither file.
- [x] 1.2 Add `resolveDbPath(env?, cwd?)` to `lib/store.ts` per design D12 — `MOCK_DB_FILE` override, relative paths resolved against cwd, default `./mocks.db`, mirroring `resolveConfigPath`. Verify: new unit tests for default, relative, and absolute resolution pass (`npx vitest run lib/store.test.ts`).
- [x] 1.3 Rework `MockStore` construction per design D9/D11: constructor takes a database location (default `resolveDbPath()`), opens a `DatabaseSync`, sets the `busy_timeout` pragma, creates the `mocks` table with `CREATE TABLE IF NOT EXISTS` (exact columns per D9), initializes the `seq` counter from `COALESCE(MAX(seq), 0)` (D10), and gains a `close()` method. Verify: unit test opens a store on a temp file (file created, schema creation idempotent across reopen) and passes.
- [x] 1.4 Port CRUD to prepared statements with unchanged synchronous signatures per D9: `add` (uuid id, headers as JSON text, absent body → SQL `NULL` vs literal JSON null → text `'null'`), `list` (`ORDER BY seq`, parse JSON, omit `body` key when absent), `deleteById` (boolean from change count), `clearAll`; update direct `new MockStore()` call sites in `lib/store.test.ts` and `lib/config.test.ts` to `new MockStore(':memory:')`. Verify: all pre-existing store behavior tests pass plus a new round-trip test over every `Json` variant (string, number, boolean, null, array, object, absent body).

## 2. Seed-when-empty and startup fail-fast

- [x] 2.1 Change `seedStoreFromFile` in `lib/config.ts` per design D13: always read and validate the config file; insert entries in file order via `store.add` only when the store is empty; extend the return value so the caller can log the decision (seeded count vs skipped-because-non-empty). Verify: config unit tests pass — fresh store seeds in file order; non-empty store inserts nothing and leaves existing mocks untouched; invalid config still throws even when the store is non-empty.
- [x] 2.2 Keep the `getStore()` globalThis singleton per D11/D14, caching the store instance that owns the single open connection, with construction errors naming the database path; update the singleton/HMR tests to point `MOCK_DB_FILE` at a temp path before importing. Verify: singleton and simulated-module-reimport tests pass and no `mocks.db` appears in the repo root.
- [x] 2.3 Update `instrumentation.ts` per D13/D14: database open/creation errors take the existing fail-fast path (message naming the path, `process.exit(1)`); startup log reports either the seeded count or that seeding was skipped because the store is non-empty. Verify: `MOCK_DB_FILE=./missing-dir/x.db npm start` exits 1 with an error naming the path before the server listens, and a normal start logs the seeded/skipped line.

## 3. Test isolation and persistence coverage

- [x] 3.1 Configure vitest (`setupFiles` in `vitest.config.ts`) so every test file gets an isolated database — temp `MOCK_DB_FILE` or `:memory:` — since route-handler tests use `getStore()` and must never touch the repo root. Verify: full `npm test` is green and no `mocks.db*` exists in the repo root afterwards.
- [x] 3.2 Add restart-persistence tests, modeling a restart as `close()` + reopening the same temp-file database (D11), covering every `mock-store` delta scenario: runtime registration survives with its original id; delete-by-id survives; clear-all survives; listing order survives; identical-pattern tie-break precedence survives (second registration still wins). Verify: the new tests pass (`npx vitest run lib/store.test.ts`).

## 4. Docs and metadata

- [x] 4.1 Update README: replace "Mock state lives in memory. Runtime registrations are lost on restart" with the durable-SQLite behavior (state persists; config seeds only an empty store; individual deletes persist), document `MOCK_DB_FILE` and the `mocks.db` default, the reset story (`DELETE /_mocks` or delete the file while stopped), the Node ≥ 22.5 requirement, and the layout paragraph ("in-memory store" → SQLite store). Verify: `grep -i "in memory" README.md` finds no stale claim; re-read for coherence with the delta specs.
- [x] 4.2 Add `"engines": { "node": ">=22.5.0" }` to `package.json`. Verify: `npm test` still green (engines is advisory without engine-strict).
- [x] 4.3 Update the Purpose line in `openspec/specs/mock-admin-api/spec.md` — "shared in-memory mock store" becomes "shared persistent mock store" (Purpose changes are direct main-spec edits; deltas cannot express them). Runs after groups 1–3 so the spec of record only describes shipped behavior. Verify: `grep -c "in-memory" openspec/specs/mock-admin-api/spec.md` returns 0.

## 5. Integration verification

- [x] 5.1 Production lifecycle against temp database and config files: `npm run build`, start with `MOCK_DB_FILE`/`MOCK_CONFIG_FILE` pointing at temp paths; register a mock via the admin API, restart, confirm it still matches and config entries were not re-seeded or duplicated; delete one mock by id, restart, confirm it stays deleted; clear-all, restart, confirm the config seeds again. Verify: observed curl outputs match every `mock-store` and `mock-config` delta scenario exercised.
- [x] 5.2 Run `npm run smoke` against the production build from 5.1. Verify: all checks pass unchanged — its deterministic clear-all start/end keeps repeated runs stable on a persistent database.
