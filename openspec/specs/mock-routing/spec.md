# mock-routing Specification

## Purpose

Accepts any inbound HTTP request, matches it against registered mocks by method and URI pattern, and serves the pre-defined response. Defines matching semantics, precedence for overlapping patterns, and fallback behavior for unmatched traffic.

## Requirements

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

On a match the server SHALL respond with the mock's registered status code, headers, and body exactly as registered. When the mock registration omits a status code, the response status SHALL be `200`. When it omits headers, no additional response headers SHALL be added beyond server defaults. When the matched mock declares a `bodySchema`, the registered response SHALL be served only after the request body passes validation; a failing body receives the `400` described in "Validate request body against mock-declared schema".

#### Scenario: Full pre-defined response

- **WHEN** a matching request arrives for a mock registered with status `201`, header `X-Trace: abc`, and a JSON body
- **THEN** the response has status `201`, includes the header `X-Trace: abc`, and carries the registered body

#### Scenario: Default status when omitted

- **WHEN** a matching request arrives for a mock registered with only a body
- **THEN** the response status is `200` and carries the registered body

### Requirement: Validate request body against mock-declared schema

A mock MAY declare an optional `bodySchema`: a JSON Schema object describing the expected request body. When a request matches such a mock by method and URI, the server SHALL read the request body, parse it as JSON, and validate it against `bodySchema`. When validation fails, the server SHALL respond `400` with a JSON error whose `details` list names each violation (its location in the body and a message) instead of serving the mock's registered response. A request with an absent, empty, or non-JSON body SHALL fail validation the same way. When validation succeeds, the registered response SHALL be served unchanged. Body-schema rejection SHALL NOT fall through to lower-precedence mocks: the method+URI winner is final. A call rejected by body validation SHALL still be journaled as a matched call under the registered mock pattern. Mocks without `bodySchema` SHALL behave exactly as before: the request body is never read and cannot cause a `400`.

#### Scenario: Valid body serves the mock response

- **WHEN** a mock for `POST /orders` declares a `bodySchema` requiring a `name` string, and a client sends `POST /orders` with body `{"name": "widget"}`
- **THEN** the response is the mock's registered status, headers, and body

#### Scenario: Invalid body is rejected with details

- **WHEN** the same mock is registered and a client sends `POST /orders` with body `{"name": 42}`
- **THEN** the response is `400` with a JSON error whose `details` identify the offending location (`/name`) and the violation, and the mock's registered response is not served

#### Scenario: Missing or non-JSON body is rejected

- **WHEN** a mock with `bodySchema` matches a request whose body is empty or not valid JSON
- **THEN** the response is `400` with a JSON error

#### Scenario: Schema rejection does not fall through

- **WHEN** both `POST /orders/:id` (with `bodySchema`) and `POST /orders/*` (without) are registered, and a client sends `POST /orders/1` with a body failing the schema
- **THEN** the response is `400` from the winning mock, not the wildcard mock's response

#### Scenario: Rejected call is journaled as matched

- **WHEN** a request is rejected by body-schema validation and a client sends `GET /_mocks/stats`
- **THEN** the call counts under the registered mock pattern with `"matched": true`

#### Scenario: Mocks without bodySchema never read the body

- **WHEN** a mock without `bodySchema` matches a request carrying a malformed or absent body
- **THEN** the registered response is served as before, with no `400`

### Requirement: Generate response body from mock-declared schema

A mock MAY declare an optional `responseSchema`: a JSON Schema object describing its response body. When a request matches such a mock by method and URI, the server SHALL generate a fresh JSON body conforming to `responseSchema` for every call and serve it with the mock's registered status code and headers — a mock with `responseSchema` has no registered body. When no `Content-Type` header is registered, the generated response SHALL be served as `application/json`. `HEAD` requests SHALL receive status and headers with no body, and null-body statuses SHALL omit the generated body, exactly as for static mocks. Mocks without `responseSchema` SHALL be unaffected: their registered responses are served as before.

#### Scenario: Generated body conforms to the schema

- **WHEN** a mock for `GET /users/:id` declares a `responseSchema` requiring an integer `id` and a string `name`, and a client sends `GET /users/42`
- **THEN** the response is `200` with `Content-Type: application/json` and a body containing an integer `id` and a string `name`

#### Scenario: Fresh data on every call

- **WHEN** a client calls the same `responseSchema` mock twice
- **THEN** both responses are `200` with bodies conforming to the schema, each generated independently for its call

#### Scenario: Registered status and headers still apply

- **WHEN** a mock with `responseSchema` is registered with status `201` and header `X-Trace: abc`, and a matching request arrives
- **THEN** the response has status `201`, includes `X-Trace: abc`, and carries the generated body

#### Scenario: HEAD skips the generated body

- **WHEN** a `HEAD` mock with `responseSchema` matches a request
- **THEN** the response carries the registered status and headers and no body

#### Scenario: Mocks without responseSchema are untouched

- **WHEN** a mock registered with a static `body` and no `responseSchema` matches a request
- **THEN** the registered body is served exactly as before

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

### Requirement: Unmatched requests receive a JSON 500

When no registered mock matches a request and the request does not target the reserved admin prefix, the server SHALL respond with status `500` and a JSON body that identifies the unmatched method and path.

#### Scenario: No matching mock

- **WHEN** the server receives `GET /unknown` and no mock matches
- **THEN** the response status is `500` with a JSON body naming the method `GET` and the path `/unknown`

### Requirement: Reserved admin prefix is never mockable

Requests whose path starts with the reserved admin prefix `/_mocks` SHALL be handled by the admin API and SHALL NOT match any registered mock, even if a mock with an overlapping pattern was somehow stored.

#### Scenario: Admin prefix bypasses mock matching

- **WHEN** the server receives `GET /_mocks`
- **THEN** the admin API responds and no registered mock is consulted
