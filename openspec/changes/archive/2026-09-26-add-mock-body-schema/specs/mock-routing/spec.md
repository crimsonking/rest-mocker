# Spec Delta

## ADDED Requirements

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

## MODIFIED Requirements

### Requirement: Serve the pre-defined response

On a match the server SHALL respond with the mock's registered status code, headers, and body exactly as registered. When the mock registration omits a status code, the response status SHALL be `200`. When it omits headers, no additional response headers SHALL be added beyond server defaults. When the matched mock declares a `bodySchema`, the registered response SHALL be served only after the request body passes validation; a failing body receives the `400` described in "Validate request body against mock-declared schema".

#### Scenario: Full pre-defined response

- **WHEN** a matching request arrives for a mock registered with status `201`, header `X-Trace: abc`, and a JSON body
- **THEN** the response has status `201`, includes the header `X-Trace: abc`, and carries the registered body

#### Scenario: Default status when omitted

- **WHEN** a matching request arrives for a mock registered with only a body
- **THEN** the response status is `200` and carries the registered body
