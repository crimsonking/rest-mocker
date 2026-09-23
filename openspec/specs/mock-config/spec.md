# mock-config Specification

## Purpose

Seeds the mock store from a JSON configuration file at server startup so common mocks are available immediately, validates the file, and fails fast with an actionable error when the configuration is invalid.

## Requirements

### Requirement: Seed mocks from a JSON config file at startup

At startup the server SHALL load mocks from a JSON config file whose path defaults to `mocks.json` in the project root and is overridable via the `MOCK_CONFIG_FILE` environment variable. The file SHALL contain a JSON array of entries, each with `method` and `uri` and optional `status`, `headers`, and `body`. The config file SHALL be read and validated at every startup, but its entries SHALL be registered only when the persistent mock store is empty at startup — a first run on a fresh database, or a restart after clear-all. When the store already holds mocks, no config entries SHALL be inserted and the existing store contents SHALL remain unchanged. Seeded entries SHALL be registered in file order, and seeded mocks SHALL behave exactly like runtime-registered mocks for matching and precedence.

#### Scenario: Seeded mocks match immediately

- **WHEN** the server starts with an empty persistent store and a valid config file containing `GET /health`, and a client sends `GET /health`
- **THEN** the pre-defined response is returned without any admin API call

#### Scenario: Missing config file is allowed

- **WHEN** the server starts and no config file exists at the resolved path
- **THEN** the server starts normally, leaving the persistent store contents as they are

#### Scenario: File order drives precedence

- **WHEN** a config file lists two entries for `GET /orders` and the server starts with an empty persistent store
- **THEN** a matching request receives the response of the entry appearing later in the file

#### Scenario: Restart with a non-empty store skips seeding

- **WHEN** the server restarts while the persistent store already holds mocks and the config file lists entries
- **THEN** no config entries are inserted, the listing contains exactly the mocks stored before the restart, and no duplicates appear

#### Scenario: Deleted seeded mocks stay deleted

- **WHEN** a config-seeded mock was deleted by id while other mocks remain in the store, and the server restarts
- **THEN** the deleted mock is neither listed nor matched, and the remaining mocks are unchanged

### Requirement: Fail fast on invalid config

When the config file exists but cannot be parsed as JSON, is not a JSON array, or contains an entry that fails validation — missing or invalid `method`, `uri` missing or not starting with `/`, `uri` starting with the reserved prefix `/_mocks`, or wrong types for `status`, `headers`, or `body` — the server SHALL refuse to start and SHALL print an error identifying the config file path and the offending entry.

#### Scenario: Malformed JSON

- **WHEN** the server starts with a config file containing malformed JSON
- **THEN** startup fails with an error naming the file path, and the server does not listen

#### Scenario: Invalid entry

- **WHEN** the server starts with a config file whose third entry has `"method": "FETCH"`
- **THEN** startup fails with an error naming the file path and the offending entry, and the server does not listen

### Requirement: Seeded mocks are manageable at runtime

Seeded mocks SHALL appear in the admin listing with assigned ids and SHALL be deletable individually or via clear-all. After a clear-all, seeded mocks SHALL NOT be restored until the server restarts and reloads the config file.

#### Scenario: Seeded mock visible and deletable

- **WHEN** the server started with a seeded mock and a client sends `GET /_mocks`
- **THEN** the seeded mock appears in the list with an `id`, and `DELETE /_mocks/{id}` removes it

#### Scenario: Restart restores seeded mocks

- **WHEN** all mocks were cleared and the server restarts with the same valid config file
- **THEN** the seeded mocks match again
