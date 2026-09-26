# Spec Delta

## ADDED Requirements

### Requirement: Response schemas in the config file

Config file entries MAY declare an optional `responseSchema` field with the same meaning and validation rules as the admin API: a valid, satisfiable JSON Schema object, mutually exclusive with `body`. An entry with a valid `responseSchema` SHALL be seeded like any other entry and SHALL generate a fresh conforming body per call. When an entry's `responseSchema` is invalid or combined with `body`, the server SHALL refuse to start and SHALL print an error identifying the config file path and the offending entry, exactly as for other invalid entries.

#### Scenario: Seeded response schema generates data

- **WHEN** the server starts with an empty persistent store and a config entry `GET /users/:id` declaring a `responseSchema`, and a client sends `GET /users/7`
- **THEN** the response is `200` with a generated body conforming to the schema, without any admin API call

#### Scenario: Invalid response schema fails startup

- **WHEN** the server starts with a config file whose second entry has `"responseSchema": {"type": "nope"}`
- **THEN** startup fails with an error naming the file path and the offending entry, and the server does not listen

#### Scenario: Conflicting entry fails startup

- **WHEN** the server starts with a config file whose entry declares both `body` and `responseSchema`
- **THEN** startup fails with an error naming the file path and the offending entry, and the server does not listen
