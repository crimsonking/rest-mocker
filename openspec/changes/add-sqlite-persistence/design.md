# Design

## Context

Motivation in proposal.md — Why; behavior contracts in `specs/mock-store` and `specs/mock-config` deltas. Current state: `lib/store.ts` is a `Map`-backed in-memory store with a monotonic `seq` counter, cached on `globalThis` for HMR (archived design D3); `instrumentation.ts` seeds from `mocks.json` at startup and hard-exits on invalid config (archived design D6); all route handlers call the store synchronously. Numbering below continues the archived design's D1–D7 sequence so existing code comments (`design D3`, `D6`, `D7`) stay unambiguous.

Constraints: Node ≥ 22.5 for `node:sqlite` (project runtime verified: v26.8.2, `DatabaseSync` available, no experimental warning). Next.js 15.5 route handlers and the instrumentation hook run in the `nodejs` runtime only. Zero-runtime-dependency posture (only next/react/react-dom today).

## Goals / Non-Goals

**Goals:**
- Keep the `MockStore` public interface synchronous and unchanged (`add`/`list`/`deleteById`/`clearAll`), so route handlers, matcher, and response code need no edits.
- Exactly one open database connection per process, surviving dev-mode HMR.
- Tests never touch the repo-root `mocks.db`; every test store is `:memory:` or a temp file.
- Startup fails fast with an actionable, path-naming error for an unusable database, mirroring invalid-config handling.

**Non-Goals:**
- Async store interface, connection pooling, or multi-process/multi-server sharing of one database file.
- Schema-migration framework or schema versioning for this first version.
- HTTP controls for persistence (no new endpoints; reset is clear-all or deleting the file).

## Decisions

### D8: `node:sqlite` `DatabaseSync` as the driver
Built into Node (≥ 22.5), zero new dependencies, synchronous API — which is the deciding property: `MockStore` stays sync and every call site is untouched. The used surface is minimal: `new DatabaseSync(path)`, `exec`, `prepare(...).run/get/all`, `close`.
*Alternatives:* `better-sqlite3` — API-equivalent and mature, but a native build toolchain plus `serverExternalPackages` wiring in `next.config.ts`; rejected as needless dependency cost. Async drivers (`libsql`, ORM layers) — would force a Promise-returning store interface through every route handler for no benefit in a single-process dev tool; rejected.

### D9: Single `mocks` table, JSON text columns, no migration framework
`CREATE TABLE IF NOT EXISTS mocks (id TEXT PRIMARY KEY, method TEXT NOT NULL, uri TEXT NOT NULL, status INTEGER NOT NULL, headers TEXT NOT NULL, body TEXT NULL, seq INTEGER NOT NULL UNIQUE)`, created on every open. `headers` and `body` are stored as `JSON.stringify` text. Absent body = SQL `NULL`; a registered JSON literal `null` body = the text `'null'` — so "no body" and "body is null" round-trip distinctly (`body?: Json` in `MockRoute` preserved). `list()` is `SELECT ... ORDER BY seq`.
*Alternative:* schema-migration tooling — rejected for a single-version dev-tool schema; `user_version`-based migrations can be introduced if the schema ever changes.

### D10: `seq` continuity from persisted maximum
The in-memory counter initializes at open from `SELECT COALESCE(MAX(seq), 0) FROM mocks` and increments per `add`, exactly as today. Within a process it never resets (existing "clearAll keeps sequencing monotonic" test holds); across restarts new registrations outrank persisted ones, preserving the latest-wins tie-break. After clear-all plus restart the counter restarts at 1 — unobservable, since no rows survive to compare against.
*Alternative:* a `meta` table storing the counter — rejected; extra state with no observable gain over `MAX(seq)`.

### D11: Singleton caches the open connection; constructor takes a location; explicit `close()`
The `globalThis` singleton pattern (archived D3) is kept, now caching the `MockStore` instance that owns the single open `DatabaseSync`. `MockStore`'s constructor takes the database location (default: resolved path per D12), so tests construct isolated stores with `':memory:'` or temp files; a new `close()` method lets restart-persistence tests reopen the same file with a second instance — the test-level model of a server restart.

### D12: Path resolution mirrors the config loader
`MOCK_DB_FILE` env var; relative paths resolve against `process.cwd()`; default `./mocks.db` — same rules and shape as `resolveConfigPath`/`MOCK_CONFIG_FILE`, so the two knobs behave identically. `.gitignore` gains `mocks.db*` (covers `-journal`/`-wal` side files).

### D13: Seed-when-empty; validation stays unconditional
Startup flow in `instrumentation.ts` → `lib/config.ts`: open the database (fail fast per D14), then read and validate the config file **at every startup** — the "Fail fast on invalid config" requirement is unchanged and stays consistent with the always-validating `scripts/check-mocks.ts` predev/prestart gate. Insert entries only when `SELECT EXISTS(SELECT 1 FROM mocks)` is false; insert in file order through the same `add()` path so ids and `seq` behave identically to runtime registration. Log line reports either the seeded count or that seeding was skipped because the store is non-empty.

### D14: Database errors hard-exit like config errors
An unopenable/uncreatable database throws from `getStore()`/`MockStore` construction; the instrumentation hook catches it, prints the message naming the database path, and calls `process.exit(1)` — the archived D6 finding applies unchanged: on Next 15.5 a bare `register()` throw logs "Failed to prepare server" and hangs without listening. `scripts/check-mocks.ts` stays config-only (it must not create the database file as a side effect of a prestart check).

## Recorded Assumptions

Spec-silent edge cases pinned here:

- **Reset story**: users clear state via `DELETE /_mocks` (durable) or by deleting `mocks.db` while the server is stopped; README documents both.
- **Journal mode**: SQLite default journal (no WAL) — one process, synchronous serialized writes on the event loop; WAL's extra `-wal`/`-shm` files buy nothing here. A `busy_timeout` pragma (e.g. 5000 ms) absorbs the rare second-process overlap instead of failing instantly.
- **`smoke.mjs` compatibility**: the script starts and ends with clear-all, so repeated runs against a persistent database stay deterministic; no changes needed.
- **`getStore()` in tests**: singleton tests set `MOCK_DB_FILE` to a temp path before importing, keeping `./mocks.db` untouched.

## Risks / Trade-offs

- [`node:sqlite` API is young; behavior could shift across Node majors] → the used surface is five calls; README documents Node ≥ 22.5; driver swap would touch only `lib/store.ts`.
- [Stale state surprise: mocks now resurrect after restart — the point of the change, but a behavior flip for existing users] → marked **BREAKING** in the proposal; startup log states store size/seeding decision; README rewrite of the "state lives in memory" sections.
- [Two processes on one database file → `SQLITE_BUSY`] → single-process assumption documented; `busy_timeout` mitigates brief overlaps; not a goal to support clustering.
- [Corrupt or foreign database file at the resolved path] → open/prepare failures surface via D14's fail-fast naming the path; recovery is deleting the file.
- [Body fidelity through JSON text round-trip] → `NULL` vs `'null'` distinction (D9) plus round-trip unit tests over every `Json` variant.

## Migration Plan

No data migration: the in-memory store never persisted anything. First run after the change creates a fresh `mocks.db` → empty → seeds from `mocks.json` exactly as today, so the upgrade path is behavior-compatible on first start. Rollback: revert the change and delete `mocks.db`; the in-memory store returns with no residue.
