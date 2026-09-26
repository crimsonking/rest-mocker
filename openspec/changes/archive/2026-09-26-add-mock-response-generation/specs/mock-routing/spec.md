# Spec Delta

## ADDED Requirements

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
