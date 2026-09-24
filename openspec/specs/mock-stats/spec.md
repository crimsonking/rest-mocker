# mock-stats Specification

## Purpose

Records every request that reaches the mock server in an in-memory call journal, aggregated per endpoint and caller, so tests and developers can verify who called which API and how many times during a server's lifetime.

## Requirements

### Requirement: Record matched calls aggregated per mock endpoint

Every request that matches a registered mock SHALL be recorded in the call journal. Journal entries SHALL aggregate per combination of HTTP method, matched mock URI pattern, and caller; each matching request SHALL increment the entry's `count` and update its `lastCalledAt` timestamp. Recording SHALL NOT alter the served mock response.

#### Scenario: Calls matching one pattern aggregate

- **WHEN** a mock is registered for `GET /users/:id` and the requests `/users/1`, `/users/2`, `/users/1` arrive from the same caller
- **THEN** the journal holds exactly one entry for `GET /users/:id` by that caller with `count` `3`

#### Scenario: Recording is invisible to the caller

- **WHEN** a request matching a mock registered with a custom status, headers, and body arrives
- **THEN** the response carries the registered status, headers, and body exactly as if recording were disabled

### Requirement: Record unmatched calls aggregated per request path

A request that matches no registered mock and does not target the reserved admin prefix SHALL be recorded as an unmatched entry, aggregated per HTTP method, normalized request path, and caller, and distinguished from matched entries in the journal.

#### Scenario: Unmatched requests are counted

- **WHEN** `GET /nope` arrives twice from the same caller and no mock matches
- **THEN** the journal holds one unmatched entry for `GET /nope` with `count` `2`

#### Scenario: Matched and unmatched history for one path stay separate

- **WHEN** a mock for `GET /health` is called once, then deleted, and `GET /health` arrives again
- **THEN** the journal shows a matched entry for `GET /health` with `count` `1` and a separate unmatched entry for `GET /health` with `count` `1`

### Requirement: Identify the caller by a configurable request header

The caller of a recorded call SHALL be the value of the request header named by the `MOCK_STATS_CALLER_HEADER` environment variable (default `User-Agent`, matched case-insensitively). When the header is absent or its value is empty, the caller SHALL be recorded as `unknown`. Calls to the same method and URI from different callers SHALL aggregate into separate journal entries.

#### Scenario: Default header distinguishes callers

- **WHEN** two requests for the same mock arrive, one with `User-Agent: suite-a` and one with `User-Agent: suite-b`
- **THEN** the journal holds two entries for that endpoint with `count` `1` each, callers `suite-a` and `suite-b`

#### Scenario: Custom caller header

- **WHEN** the server runs with `MOCK_STATS_CALLER_HEADER=X-Client-Id` and a request carrying `X-Client-Id: web` reaches a registered mock
- **THEN** the journal entry for that call has caller `web`

#### Scenario: Missing caller header

- **WHEN** a request arrives without the configured caller header, or with an empty value
- **THEN** the journal entry for that call has caller `unknown`

### Requirement: Exclude the reserved admin prefix from the journal

Requests targeting the reserved `/_mocks` prefix SHALL NOT be recorded in the call journal, whether they are served by the admin API or rejected as unmapped admin subpaths.

#### Scenario: Admin traffic is not recorded

- **WHEN** `GET /_mocks`, a `POST /_mocks` registration, and `GET /_mocks/deep/sub` (unmapped) arrive
- **THEN** none of them produces a journal entry, while a subsequent matching request to a registered mock is recorded

### Requirement: The journal is in-memory and starts empty

The call journal SHALL live only in the server process memory: it SHALL start empty at server startup and be lost on restart, independent of the durable mock state. Journal lifecycle SHALL NOT affect registered mocks.

#### Scenario: Restart clears statistics but keeps mocks

- **WHEN** calls have been recorded, the server restarts, and the statistics report is requested
- **THEN** the report shows no entries while `GET /_mocks` still lists every persisted mock
