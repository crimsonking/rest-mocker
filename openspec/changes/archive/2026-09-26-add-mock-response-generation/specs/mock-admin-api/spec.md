# Spec Delta

## ADDED Requirements

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
