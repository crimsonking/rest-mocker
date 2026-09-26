# mock-admin-api Specification

## Purpose

Runtime HTTP management interface, served under the reserved `/_mocks` prefix, for registering, listing, deleting, and clearing mocks, and for retrieving and resetting call statistics, while the server runs. All endpoints speak JSON; mock CRUD operates on the shared persistent mock store, and the statistics endpoints operate on the in-memory call journal.

## Requirements

### Requirement: Register a mock at runtime

`POST /_mocks` SHALL accept a JSON body with `method` (valid HTTP method), `uri` (path starting with `/`), and optional `status`, `headers`, `body`, and `bodySchema` (a JSON Schema object applied to request bodies per the routing capability), register the mock, and respond `201` with JSON containing the stored mock and its server-assigned unique `id`. The registered mock SHALL immediately participate in request matching. Registering another mock with the same method and URI SHALL succeed; the newer registration wins matching per the precedence rules.

#### Scenario: Successful registration

- **WHEN** a client sends `POST /_mocks` with `{"method": "GET", "uri": "/ping", "status": 200, "body": "pong"}`
- **THEN** the response is `201` with the stored mock including an `id`, and a subsequent `GET /ping` returns `pong`

#### Scenario: Re-registering the same route overrides

- **WHEN** a mock for `GET /orders` is registered, then a second mock for `GET /orders` is registered with a different body, and a matching request arrives
- **THEN** the response comes from the second registration

#### Scenario: Registration with a body schema

- **WHEN** a client sends `POST /_mocks` with `{"method": "POST", "uri": "/orders", "body": {"ok": true}, "bodySchema": {"type": "object", "required": ["name"]}}`
- **THEN** the response is `201` with the stored mock including `bodySchema`, and a subsequent `POST /orders` with body `{}` receives `400`

### Requirement: Reject invalid registration payloads

`POST /_mocks` SHALL respond `400` with a JSON error describing the problem, and register nothing, when the payload is not a JSON object, `method` is missing or not a valid HTTP method, `uri` is missing or does not start with `/`, `uri` starts with the reserved prefix `/_mocks`, `status`/`headers`/`body` have wrong types, or `bodySchema` is present but is not a JSON object that is a valid JSON Schema.

#### Scenario: Missing method

- **WHEN** a client sends `POST /_mocks` with `{"uri": "/ping"}`
- **THEN** the response is `400` with a JSON error naming the missing `method`, and no mock is registered

#### Scenario: Reserved prefix rejected

- **WHEN** a client sends `POST /_mocks` with `{"method": "GET", "uri": "/_mocks/anything"}`
- **THEN** the response is `400` with a JSON error and no mock is registered

#### Scenario: Invalid body schema rejected

- **WHEN** a client sends `POST /_mocks` with `{"method": "POST", "uri": "/orders", "bodySchema": {"type": "nope"}}`
- **THEN** the response is `400` with a JSON error naming `bodySchema`, and no mock is registered

### Requirement: List all registered mocks

`GET /_mocks` SHALL respond `200` with a JSON array of every registered mock — including `id`, `method`, `uri`, `status`, `headers`, `body`, and `bodySchema` when declared — ordered oldest registration first.

#### Scenario: List shows seeded and runtime mocks

- **WHEN** the server was started with one config-seeded mock and one mock was registered via `POST /_mocks`, then a client sends `GET /_mocks`
- **THEN** the response is `200` with a two-element array, the seeded mock first

#### Scenario: List includes body schema

- **WHEN** a mock registered with `bodySchema` exists and a client sends `GET /_mocks`
- **THEN** the mock's entry in the response array includes its `bodySchema` as registered

### Requirement: Register and list mocks with a response schema

`POST /_mocks` SHALL accept an optional `responseSchema` field — a valid JSON Schema object — register the mock, and respond `201` with the stored mock including `responseSchema` and its server-assigned `id`. The registered mock SHALL immediately generate responses from the schema. `GET /_mocks` SHALL include `responseSchema` in the listing entry of every mock that declares it, and SHALL omit the field for mocks that do not.

#### Scenario: Registration with a response schema

- **WHEN** a client sends `POST /_mocks` with `{"method": "GET", "uri": "/users/:id", "responseSchema": {"type": "object", "required": ["id", "name"], "properties": {"id": {"type": "integer"}, "name": {"type": "string"}}}}`
- **THEN** the response is `201` with the stored mock including `responseSchema`, and a subsequent `GET /users/1` returns `200` with a generated body conforming to the schema

#### Scenario: Listing includes the response schema

- **WHEN** a mock registered with `responseSchema` exists alongside a mock without one, and a client sends `GET /_mocks`
- **THEN** the first mock's entry includes `responseSchema` as registered and the second mock's entry has no `responseSchema` field

### Requirement: Reject invalid or conflicting response schema registrations

`POST /_mocks` SHALL respond `400` with a JSON error describing the problem, and register nothing, when `responseSchema` is present but is not a JSON object that is a valid, satisfiable JSON Schema, or when the payload declares both `body` and `responseSchema`.

#### Scenario: Invalid response schema rejected

- **WHEN** a client sends `POST /_mocks` with `{"method": "GET", "uri": "/x", "responseSchema": {"type": "nope"}}`
- **THEN** the response is `400` with a JSON error naming `responseSchema`, and no mock is registered

#### Scenario: Body and response schema are mutually exclusive

- **WHEN** a client sends `POST /_mocks` with both `"body": {"a": 1}` and a valid `responseSchema`
- **THEN** the response is `400` with a JSON error stating that `body` and `responseSchema` cannot be combined, and no mock is registered

### Requirement: Delete a single mock

`DELETE /_mocks/{id}` SHALL remove the mock with that `id` and respond `204`. When no mock has the given `id`, it SHALL respond `404` with a JSON error and change nothing. Removed mocks SHALL stop participating in matching immediately.

#### Scenario: Successful delete

- **WHEN** a client deletes a registered mock by `id` and then sends a request that previously matched it
- **THEN** the delete responds `204` and the request now receives the unmatched `500` JSON error

#### Scenario: Unknown id

- **WHEN** a client sends `DELETE /_mocks/does-not-exist`
- **THEN** the response is `404` with a JSON error and the mock store is unchanged

### Requirement: Clear all mocks

`DELETE /_mocks` SHALL remove every registered mock, including config-seeded ones, and respond `204`. Cleared mocks SHALL NOT be re-seeded until the server restarts.

#### Scenario: Clear all

- **WHEN** mocks exist from config seeding and runtime registration, a client sends `DELETE /_mocks`, and then sends a request that previously matched
- **THEN** the clear responds `204`, `GET /_mocks` returns an empty array, and the request receives the unmatched `500` JSON error

### Requirement: Retrieve call statistics

`GET /_mocks/stats` SHALL respond `200` with a JSON object containing a `callerHeader` field — the name of the caller-identifying header in effect — and an `entries` array of journal entries. Each entry SHALL carry `method`, `uri` (the matched mock pattern or the unmatched request path), `matched` (boolean), `caller`, `count` (integer), and `lastCalledAt` (ISO 8601 timestamp). Entries SHALL be ordered by `count` descending, ties broken by `method` ascending, then `uri` ascending, then `caller` ascending. When no calls have been recorded, `entries` SHALL be an empty array.

#### Scenario: Report reflects recorded calls

- **WHEN** one caller made two calls to a matched `GET /ping` mock, another caller made one call to an unregistered `GET /missing`, and a client sends `GET /_mocks/stats`
- **THEN** the response is `200` with `entries` ordered most-called first — the matched `GET /ping` entry with `count` `2` before the unmatched `GET /missing` entry with `count` `1` — each naming its caller and last-called timestamp, and `callerHeader` naming the configured header

#### Scenario: Empty journal

- **WHEN** no mock traffic has arrived since startup or the last reset and a client sends `GET /_mocks/stats`
- **THEN** the response is `200` with an empty `entries` array

### Requirement: Reset call statistics

`DELETE /_mocks/stats` SHALL remove every journal entry and respond `204`. Registered mocks SHALL NOT be affected. Resetting an already-empty journal SHALL succeed identically.

#### Scenario: Reset clears the journal and keeps mocks

- **WHEN** calls have been recorded, a client sends `DELETE /_mocks/stats`, and then sends `GET /_mocks/stats` and `GET /_mocks`
- **THEN** the reset responds `204`, the statistics report shows an empty `entries` array, and the mock listing is unchanged

#### Scenario: Reset on an empty journal

- **WHEN** no calls have been recorded and a client sends `DELETE /_mocks/stats`
- **THEN** the response is `204`

#### Scenario: Counting resumes after reset

- **WHEN** a journal entry shows `count` `5`, the journal is reset, and one more matching call arrives
- **THEN** the report shows that entry with `count` `1`
