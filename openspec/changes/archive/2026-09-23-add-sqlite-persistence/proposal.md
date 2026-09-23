# Proposal

## Why

Mock state lives only in process memory: runtime registrations vanish on every restart, and the store survives dev-mode reloads solely through a globalThis hack. Backing the store with SQLite makes mock state durable across restarts while keeping the synchronous, dependency-light design of this developer tool.

## What Changes

- Replace the in-memory `Map` inside `MockStore` with a SQLite database using Node's built-in `node:sqlite` (`DatabaseSync`). No new npm dependencies; verified available on this project's runtime (Node 26.8.2, requires Node ≥ 22.5).
- Always-on: the default database file is `mocks.db` in the project root (gitignored), overridable via a `MOCK_DB_FILE` environment variable. Tests use in-memory or per-test temporary databases.
- **BREAKING** (restart behavior): runtime-registered mocks now persist across restarts. The config file (`mocks.json` / `MOCK_CONFIG_FILE`) is still read and validated at every startup — invalid config still fails fast — but its entries are inserted only when the persistent store is empty (first run on a fresh database, or after clear-all). Individual deletes of config-seeded mocks now persist across restarts.
- Unchanged: the synchronous `MockStore` interface (`add` / `list` / `deleteById` / `clearAll`), all HTTP surfaces (admin API, catch-all routing, matching and precedence semantics), and `scripts/check-mocks.ts`.

## Capabilities

### New Capabilities

- `mock-store`: Durable SQLite-backed storage of mock routes — registrations, deletions, listing order, and precedence sequencing preserved across process restarts; database file resolution (`mocks.db` default, `MOCK_DB_FILE` override); fail-fast startup when the database cannot be opened or created.

### Modified Capabilities

- `mock-config`: Startup seeding becomes conditional on an empty persistent store. Validation and fail-fast behavior are unchanged; the clear-all → restart → re-seed path is preserved; a restart with a non-empty store no longer re-adds config entries and no longer restores individually deleted seeded mocks.

## Non-goals

- No other database engines and no storage-abstraction layer designed for future engines — SQLite only.
- No request logging, hit counters, or new admin endpoints; the HTTP API surface is unchanged.
- No changes to matching semantics or precedence rules.
- No migration tooling for existing data (the in-memory store never had any).
- No restart cycle inside `scripts/smoke.mjs`; restart persistence is covered by tests that reopen the database, not by driving the production server twice.

## Impact

- `lib/store.ts`: `MockStore` rewritten over `DatabaseSync`; globalThis singleton now caches the open database connection (HMR-safe); `seq` counter initialized from persisted maximum so registration order and tie-break precedence survive restarts.
- `lib/config.ts`: `seedStoreFromFile` validates always, inserts only when the store is empty.
- `instrumentation.ts`: fail-fast on an unopenable database, mirroring invalid-config handling.
- `.gitignore`: add `mocks.db`.
- Tests: `lib/store.test.ts` and `lib/config.test.ts` reworked for per-test databases; new coverage for restart persistence and seed-when-empty.
- Docs: README sections claiming "Mock state lives in memory" and describing restart/seed behavior.
- Untouched: route handlers, matcher, validation, response assembly, `scripts/check-mocks.ts`, `scripts/smoke.mjs`.
