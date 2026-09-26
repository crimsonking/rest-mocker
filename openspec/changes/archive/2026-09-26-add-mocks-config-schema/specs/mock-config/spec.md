# Spec Delta

## ADDED Requirements

### Requirement: Object-wrapper config form with schema self-reference

The config file SHALL be either a JSON array of mock definitions or a JSON object with a required `mocks` array and an optional `$schema` string, and the object form SHALL carry no keys other than `$schema` and `mocks`. Entries from both forms SHALL be validated and seeded identically — same rules, same file order, same seed-when-empty behavior — and error messages for invalid entries SHALL name the config file path and the entry index within `mocks` exactly as for the array form. A file that is neither a JSON array nor a valid wrapper object, or a wrapper with unknown keys or a non-array `mocks` value, SHALL stop the server before it listens with an error naming the config file path. The `$schema` value SHALL NOT be resolved, fetched, or validated at runtime; it exists for editor tooling.

#### Scenario: Wrapper form seeds identically to the array form

- **WHEN** the server starts with an empty persistent store and a config file `{"$schema": "./mocks.schema.json", "mocks": [{"method": "GET", "uri": "/health", "body": "ok"}]}`, and a client sends `GET /health`
- **THEN** the entry is seeded and the pre-defined response is returned, exactly as for the equivalent array-form file

#### Scenario: Bare array form remains valid

- **WHEN** the server starts with a config file containing a bare JSON array of valid entries
- **THEN** the entries load and seed exactly as before this requirement existed

#### Scenario: Wrapper with an unknown key fails startup

- **WHEN** the server starts with a config file `{"mocks": [], "mock": []}`
- **THEN** startup fails with an error naming the file path, and the server does not listen

#### Scenario: Invalid entry in wrapper form names file and entry index

- **WHEN** the server starts with a wrapper-form config whose second `mocks` entry has `"method": "FETCH"`
- **THEN** startup fails with an error naming the file path and entry index 1, and the server does not listen

#### Scenario: Schema key is not resolved at runtime

- **WHEN** the server starts with a wrapper-form config whose `$schema` points at a nonexistent or unreachable path and whose entries are valid
- **THEN** the server starts normally and the entries seed
