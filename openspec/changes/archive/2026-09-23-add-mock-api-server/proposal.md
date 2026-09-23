# Proposal

## Why

E2E and integration tests need deterministic API behavior without depending on real backends. This repo (currently greenfield) gets a standalone mock server: it accepts any HTTP request and, when the request method and URI match a registered mock, replies with a pre-defined status, headers, and body.

## What Changes

- Scaffold a TypeScript / Node.js / Next.js application that runs the mock server.
- Catch-all request handling: match incoming requests against registered mocks by HTTP method and URI pattern — exact segments, `:param` path parameters, and `*` wildcards — and return the mock's pre-defined status code, headers, and body.
- Deterministic precedence when several mocks could match: exact beats path-parameter beats wildcard; among equally specific patterns, the most recently registered mock wins (later registrations override earlier ones).
- Unmatched requests receive a `404` JSON error. The reserved admin prefix is never matched as a mock target.
- Runtime admin HTTP API under the reserved `/_mocks` prefix: register, list, delete a single mock, and clear all mocks. Mock state lives in memory.
- Config-file seeding: initial mocks load from a JSON file at startup; an invalid file fails startup with a clear error. Admin API registrations layer on top of seeded mocks at runtime.

## Capabilities

### New Capabilities

- `mock-routing`: matching inbound requests by method and URI pattern and serving the pre-defined response (status, headers, body); includes precedence rules, query-string exclusion, reserved-prefix protection, and 404 behavior.
- `mock-admin-api`: HTTP endpoints to register, list, delete, and clear mocks while the server is running, backed by the in-memory store.
- `mock-config`: seeding mocks from a JSON configuration file at startup, including schema validation and fail-fast behavior on invalid input.

### Modified Capabilities

None — the project has no existing specs; all capabilities are new.

## Non-goals

- Matching on request bodies, headers, or query parameters (method + URI path only).
- Dynamic response templating, latency simulation, or fault injection.
- Persisting runtime-registered mocks across server restarts.
- Proxying or passthrough to real upstream services.
- Authentication or TLS for the admin API (local-development tool).

## Impact

- New codebase: Next.js app with a catch-all route handler for mocked traffic, route handlers for the `/_mocks` admin API, an in-memory mock store module, a config-file loader, and startup wiring.
- No existing code, APIs, or systems are affected — this is the repository's first change.
- Dependency surface stays minimal: Next.js/React per the configured stack; no additional HTTP framework.
