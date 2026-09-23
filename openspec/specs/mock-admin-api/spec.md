# mock-admin-api Specification

## Purpose

Runtime HTTP management interface, served under the reserved `/_mocks` prefix, for registering, listing, deleting, and clearing mocks while the server runs. All endpoints speak JSON and operate on the shared in-memory mock store.

## Requirements

### Requirement: Register a mock at runtime

`POST /_mocks` SHALL accept a JSON body with `method` (valid HTTP method), `uri` (path starting with `/`), and optional `status`, `headers`, and `body`, register the mock, and respond `201` with JSON containing the stored mock and its server-assigned unique `id`. The registered mock SHALL immediately participate in request matching. Registering another mock with the same method and URI SHALL succeed; the newer registration wins matching per the precedence rules.

#### Scenario: Successful registration

- **WHEN** a client sends `POST /_mocks` with `{"method": "GET", "uri": "/ping", "status": 200, "body": "pong"}`
- **THEN** the response is `201` with the stored mock including an `id`, and a subsequent `GET /ping` returns `pong`

#### Scenario: Re-registering the same route overrides

- **WHEN** a mock for `GET /orders` is registered, then a second mock for `GET /orders` is registered with a different body, and a matching request arrives
- **THEN** the response comes from the second registration

### Requirement: Reject invalid registration payloads

`POST /_mocks` SHALL respond `400` with a JSON error describing the problem, and register nothing, when the payload is not a JSON object, `method` is missing or not a valid HTTP method, `uri` is missing or does not start with `/`, `uri` starts with the reserved prefix `/_mocks`, or `status`/`headers`/`body` have wrong types.

#### Scenario: Missing method

- **WHEN** a client sends `POST /_mocks` with `{"uri": "/ping"}`
- **THEN** the response is `400` with a JSON error naming the missing `method`, and no mock is registered

#### Scenario: Reserved prefix rejected

- **WHEN** a client sends `POST /_mocks` with `{"method": "GET", "uri": "/_mocks/anything"}`
- **THEN** the response is `400` with a JSON error and no mock is registered

### Requirement: List all registered mocks

`GET /_mocks` SHALL respond `200` with a JSON array of every registered mock — including `id`, `method`, `uri`, `status`, `headers`, and `body` — ordered oldest registration first.

#### Scenario: List shows seeded and runtime mocks

- **WHEN** the server was started with one config-seeded mock and one mock was registered via `POST /_mocks`, then a client sends `GET /_mocks`
- **THEN** the response is `200` with a two-element array, the seeded mock first

### Requirement: Delete a single mock

`DELETE /_mocks/{id}` SHALL remove the mock with that `id` and respond `204`. When no mock has the given `id`, it SHALL respond `404` with a JSON error and change nothing. Removed mocks SHALL stop participating in matching immediately.

#### Scenario: Successful delete

- **WHEN** a client deletes a registered mock by `id` and then sends a request that previously matched it
- **THEN** the delete responds `204` and the request now receives the unmatched `404` JSON error

#### Scenario: Unknown id

- **WHEN** a client sends `DELETE /_mocks/does-not-exist`
- **THEN** the response is `404` with a JSON error and the mock store is unchanged

### Requirement: Clear all mocks

`DELETE /_mocks` SHALL remove every registered mock, including config-seeded ones, and respond `204`. Cleared mocks SHALL NOT be re-seeded until the server restarts.

#### Scenario: Clear all

- **WHEN** mocks exist from config seeding and runtime registration, a client sends `DELETE /_mocks`, and then sends a request that previously matched
- **THEN** the clear responds `204`, `GET /_mocks` returns an empty array, and the request receives the unmatched `404` JSON error
