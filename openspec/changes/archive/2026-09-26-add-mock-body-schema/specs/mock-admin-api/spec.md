# Spec Delta

## MODIFIED Requirements

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
