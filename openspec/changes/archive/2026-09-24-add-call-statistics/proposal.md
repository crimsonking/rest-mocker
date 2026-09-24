# Proposal

## Why

The server answers mocked requests but reports nothing about the traffic it received: an E2E suite cannot verify that the system under test actually called a mock, cannot count calls per endpoint, and calls to unregistered paths silently vanish into 404s. Call statistics make the mock server observable — who called what, how many times.

## What Changes

- Record every request that reaches the catch-all mock handler — matched and unmatched — in an in-process call journal.
- Journal entries aggregate `count` and `lastCalledAt` per method, URI (the matched mock pattern, or the raw request path when unmatched), match status, and caller.
- Caller identity is the value of a configurable request header: default `User-Agent`, override via `MOCK_STATS_CALLER_HEADER`, fallback `unknown` when the header is absent or empty.
- New admin endpoints under the reserved prefix: `GET /_mocks/stats` returns the journal as JSON; `DELETE /_mocks/stats` clears it (`204`).
- The journal is in-memory only: statistics reset on server restart, while mocks themselves stay durable in SQLite.
- Requests to the reserved `/_mocks` prefix (admin CRUD and unmapped subpaths) are never recorded.
- Mocked response behavior, matching, and precedence are unchanged. No new npm dependencies.

## Capabilities

### New Capabilities

- `mock-stats`: call-recording semantics — what gets recorded (matched calls by mock pattern, unmatched by request path), caller identification via a configurable header, count/last-called aggregation, reserved-prefix exclusion, and the in-memory lifecycle.

### Modified Capabilities

- `mock-admin-api`: added requirements for the two new endpoints — `GET /_mocks/stats` (JSON statistics report) and `DELETE /_mocks/stats` (journal reset).

## Non-goals

- No persistence of statistics across restarts and no SQLite schema changes.
- No request/response capture beyond the caller header: no bodies, no per-request log, no latency metrics.
- No HTML dashboard — JSON admin endpoint only.
- No journal size cap or eviction; a flood of random unmatched paths grows the journal (accepted for a developer tool).
- No authentication on the stats endpoints (consistent with the rest of `/_mocks`).

## Impact

- New `lib/stats.ts`: the journal with a globalThis singleton (same HMR-safe pattern as `MockStore`).
- New `app/%5Fmocks/stats/route.ts`: `GET` + `DELETE` handlers (Next.js answers `405` for other methods automatically).
- `app/[[...slug]]/route.ts`: records calls on the matched and unmatched branches.
- README: documents the endpoints and `MOCK_STATS_CALLER_HEADER`.
- Tests: new `lib/stats.test.ts` and `app/%5Fmocks/stats/route.test.ts`; catch-all route tests extended with recording coverage; `scripts/smoke.mjs` extended with a statistics lifecycle check.
- Untouched: `lib/store.ts`, `lib/matcher.ts`, `lib/validation.ts`, `lib/config.ts`, `instrumentation.ts`.
