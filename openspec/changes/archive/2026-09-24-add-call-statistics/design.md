# Design

## Context

Motivation in proposal.md — Why; behavior contracts in the `specs/mock-stats` and `specs/mock-admin-api` deltas. Current state: all mock traffic flows through one synchronous `handleMockRequest` in `app/[[...slug]]/route.ts`, which early-returns for the reserved `/_mocks` prefix before matching; the admin API lives in `app/%5Fmocks/route.ts` and `app/%5Fmocks/[id]/route.ts`, exporting only their supported methods (Next.js answers 405 automatically); the store is a `globalThis` singleton (archived design D3/D11). Tests are vitest: `vitest.setup.ts` points `MOCK_DB_FILE` at a per-file temp database, and route tests invoke handlers directly with `new Request(...)`. Numbering below continues the archived D1–D14 sequence so existing code comments stay unambiguous.

Constraints: zero-runtime-dependency posture; single Node process; the journal must be shared by two separate route modules under dev-mode HMR; no async work added to the request hot path.

## Goals / Non-Goals

**Goals:**
- One shared journal instance across the catch-all and the stats admin route, surviving dev-mode HMR.
- Recording is synchronous and cannot fail or alter a mocked response.
- Deterministic report ordering so tests and diffs are stable.
- Per-test isolation with the existing vitest setup — no new infrastructure.

**Non-Goals:**
- Persistence, size caps, eviction, or sampling.
- Multi-process/multi-instance aggregation.
- Any change to matcher, store, validation, or response-assembly code.

## Decisions

### D15: `lib/stats.ts` with a `globalThis` singleton journal
A `CallJournal` class exposed via `getStats()`, attached to `globalThis` under `__mockE2eServerStats` — the exact pattern of `getStore()` (archived D3, D11). Without `globalThis`, dev-mode HMR recompiles can leave the catch-all and the `/_mocks/stats` module holding separate journal instances, silently reporting empty stats.
*Alternatives:* a SQLite table — rejected: the journal lifecycle is deliberately in-memory (proposal), and it would add per-request write I/O plus a schema change. A plain module-level `Map` — rejected: breaks under HMR the way the store originally did.

### D16: One `Map`, composite string key, matched flag as a key dimension
`Map<string, Entry>` keyed `method + '\n' + uri + '\n' + caller + '\n' + (matched ? '1' : '0')`; `Entry = { method, uri, matched, caller, count, lastCalledAt }`. The matched flag must be part of the key because one method+uri can have both a matched and an unmatched history (spec: mock deleted between calls). Matched entries store the registered pattern (`mock.uri`), so `/users/1` and `/users/2` aggregate under `/users/:id`; unmatched entries store the request path normalized with the existing `normalizePath`. Newlines cannot appear in methods, paths, or header values, so the separator is collision-safe.
*Alternative:* nested maps (method → uri → caller) — no benefit; complicates reset and iteration.

### D17: Caller knob `MOCK_STATS_CALLER_HEADER`, read lazily, token-validated
Default `user-agent`; the env value is resolved at record time and at report time (mirrors `resolveDbPath`'s lazy env reads, so tests toggle it per test without singleton gymnastics). Extraction uses `req.headers.get(name)` — the Headers API is case-insensitive, satisfying the spec. The resolved name is checked against the HTTP token grammar once per use; an invalid configured name falls back to `user-agent` rather than throwing from `headers.get()` on every request. Value `null`, empty, or whitespace-only records caller `unknown`; otherwise the value is stored as-is.

### D18: Recording hook inside `handleMockRequest`, after the reserved-prefix check
The unmatched branch records `{ method, uri: path, matched: false }`; the matched branch records `{ method, uri: mock.uri, matched: true }`. The single choke point covers every mockable method; recording after the `isReservedPath` early return excludes admin CRUD and unmapped `/_mocks/*` subpaths by construction. `record()` is synchronous (Map update + `new Date().toISOString()`) and designed never to throw, so mocked responses cannot change and the hot path needs no try/catch.

### D19: Stats route `app/%5Fmocks/stats/route.ts` exporting GET + DELETE only
Next.js static-segment specificity beats the dynamic sibling, so `/_mocks/stats` routes here rather than to `[id]` — `DELETE /_mocks/stats` resets the journal instead of attempting a mock delete; collision is impossible anyway because mock ids are `randomUUID()`. Unexported methods get the framework's automatic 405, consistent with existing admin routes. `/_mocks/stats/deeper` is unmapped, lands in the catch-all, and is not recorded (D18 order).

### D20: Report contract and deterministic ordering
`GET` responds via `jsonResponse(200, { callerHeader, entries })`: `callerHeader` is the effective knob name; `entries` are sorted at read time by `count` descending, then `method`, `uri`, `caller` ascending — the journal Map keeps no order of its own. `lastCalledAt` is the ISO 8601 timestamp captured at record time. `DELETE` calls `reset()` and returns `new Response(null, { status: 204 })`, matching the existing 204 handlers.

### D21: Test isolation via `reset()`, no setup changes
`getStats().reset()` in `beforeEach` of the touched test files (catch-all route tests, stats route tests, journal unit tests) — the journal analogue of `getStore().clearAll()`. The lazy env read (D17) makes per-test `MOCK_STATS_CALLER_HEADER` overrides safe when restored afterwards. `vitest.setup.ts` needs no change: the journal has no file state.

## Recorded Assumptions

Spec-silent edge cases pinned here:

- Whitespace-only caller header values count as absent → `unknown` (spec says "absent or empty").
- An invalid `MOCK_STATS_CALLER_HEADER` value (not an HTTP token) falls back to the default header instead of failing requests (D17).
- All methods, including HEAD and OPTIONS, are recorded like any other; a matched mock serving an error status (e.g. registered 500) still counts as matched — `matched` describes routing, not status.
- The stats endpoints themselves are never counted: they live under the reserved prefix (D18/D19).
- `smoke.mjs` gains a stats section that resets the journal first, so it stays deterministic against a server that already served earlier checks.

## Risks / Trade-offs

- [Unbounded journal growth: random unmatched paths or a high-cardinality caller header (e.g. per-request trace ids)] → accepted for a dev tool (proposal non-goal); `DELETE /_mocks/stats` resets; README documents choosing a low-cardinality caller header.
- [Per-request overhead: env read, token check, Map update, Date allocation] → microseconds against the existing per-request SQLite `list()` read; not measurable.
- [Users may expect stats to persist like mocks do] → explicit in-memory decision (proposal); README documents the lifecycle difference.
- [Dev-mode HMR forking journal state] → `globalThis` singleton, the same protection the store uses (D15).

## Migration Plan

Purely additive: no schema change, no data migration, no altered behavior on existing endpoints. First run after the change starts with an empty journal. Rollback: revert the commit; the journal dies with the process and leaves no residue on disk.
