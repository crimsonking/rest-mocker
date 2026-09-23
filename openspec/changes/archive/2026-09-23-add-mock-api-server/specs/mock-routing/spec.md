# Spec Delta

## Purpose

Accepts any inbound HTTP request, matches it against registered mocks by method and URI pattern, and serves the pre-defined response. Defines matching semantics, precedence for overlapping patterns, and fallback behavior for unmatched traffic.

## ADDED Requirements

### Requirement: Match requests by method and URI pattern

The server SHALL match each inbound request against registered mocks by HTTP method and URI path. A registered URI pattern SHALL support exact segments, `:param` named segments matching exactly one path segment, and `*` wildcard segments matching one or more remaining path segments. The query string SHALL NOT participate in matching.

#### Scenario: Exact path match

- **WHEN** a mock is registered for `GET /health` and the server receives `GET /health`
- **THEN** the server returns the mock's pre-defined response

#### Scenario: Path parameter match

- **WHEN** a mock is registered for `GET /users/:id` and the server receives `GET /users/42`
- **THEN** the server returns the mock's pre-defined response

#### Scenario: Wildcard match

- **WHEN** a mock is registered for `GET /files/*` and the server receives `GET /files/docs/a/b.png`
- **THEN** the server returns the mock's pre-defined response

#### Scenario: Method mismatch does not match

- **WHEN** a mock is registered for `GET /health` only and the server receives `POST /health`
- **THEN** the request is treated as unmatched

#### Scenario: Query string excluded from matching

- **WHEN** a mock is registered for `GET /health` and the server receives `GET /health?verbose=1`
- **THEN** the server returns the mock's pre-defined response

### Requirement: Serve the pre-defined response

On a match the server SHALL respond with the mock's registered status code, headers, and body exactly as registered. When the mock registration omits a status code, the response status SHALL be `200`. When it omits headers, no additional response headers SHALL be added beyond server defaults.

#### Scenario: Full pre-defined response

- **WHEN** a matching request arrives for a mock registered with status `201`, header `X-Trace: abc`, and a JSON body
- **THEN** the response has status `201`, includes the header `X-Trace: abc`, and carries the registered body

#### Scenario: Default status when omitted

- **WHEN** a matching request arrives for a mock registered with only a body
- **THEN** the response status is `200` and carries the registered body

### Requirement: Deterministic precedence for overlapping patterns

When multiple registered mocks match a request, the server SHALL select exactly one: an exact-segment pattern SHALL win over a `:param` pattern, and a `:param` pattern SHALL win over a `*` wildcard pattern, compared segment by segment. Among matching mocks with identical patterns, the most recently registered SHALL win.

#### Scenario: Exact beats path parameter

- **WHEN** mocks are registered for both `GET /users/me` and `GET /users/:id` and the server receives `GET /users/me`
- **THEN** the server returns the `GET /users/me` mock's response

#### Scenario: Path parameter beats wildcard

- **WHEN** mocks are registered for both `GET /users/:id` and `GET /users/*` and the server receives `GET /users/42`
- **THEN** the server returns the `GET /users/:id` mock's response

#### Scenario: Latest registration wins on identical pattern

- **WHEN** two mocks are registered for `GET /orders`, the second after the first, and the server receives `GET /orders`
- **THEN** the server returns the second mock's response

### Requirement: Unmatched requests receive a JSON 404

When no registered mock matches a request and the request does not target the reserved admin prefix, the server SHALL respond with status `404` and a JSON body that identifies the unmatched method and path.

#### Scenario: No matching mock

- **WHEN** the server receives `GET /unknown` and no mock matches
- **THEN** the response status is `404` with a JSON body naming the method `GET` and the path `/unknown`

### Requirement: Reserved admin prefix is never mockable

Requests whose path starts with the reserved admin prefix `/_mocks` SHALL be handled by the admin API and SHALL NOT match any registered mock, even if a mock with an overlapping pattern was somehow stored.

#### Scenario: Admin prefix bypasses mock matching

- **WHEN** the server receives `GET /_mocks`
- **THEN** the admin API responds and no registered mock is consulted
