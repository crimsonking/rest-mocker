# Spec Delta

## Purpose

Durable storage of registered mocks in a SQLite database file, so mock state — registrations, deletions, listing order, and matching precedence — survives server restarts, with a configurable database location and fail-fast startup when the database is unusable.

## ADDED Requirements

### Requirement: Mock state persists across restarts

Every registered mock SHALL be stored durably in the SQLite database. After a server restart, all mocks present before the restart SHALL still be listed and matched with their original ids and fields, in the same listing order (oldest registration first) and with the same matching precedence — including the most-recent-registration tie-break for identical patterns. Mocks removed before the restart, individually or via clear-all, SHALL remain removed.

#### Scenario: Runtime registration survives restart

- **WHEN** a mock is registered via the admin API and the server restarts
- **THEN** the mock appears in `GET /_mocks` with its original id and a matching request receives its pre-defined response

#### Scenario: Precedence survives restart

- **WHEN** two mocks with identical method and URI pattern are registered (the second winning matches), the server restarts, and a matching request arrives
- **THEN** the response comes from the second registration

#### Scenario: Deletion survives restart

- **WHEN** a mock is deleted by id and the server restarts
- **THEN** the mock is absent from the listing and a request that previously matched it receives the unmatched `404` JSON error

#### Scenario: Clear-all survives restart

- **WHEN** all mocks are cleared via the admin API and the server restarts with no config file present
- **THEN** the store is still empty

### Requirement: Database file resolution

The server SHALL store mock state in a SQLite database file whose path defaults to `mocks.db` in the project root and is overridable via the `MOCK_DB_FILE` environment variable, with relative paths resolving against the working directory. The database file and its schema SHALL be created automatically when missing, and the database file SHALL be excluded from version control.

#### Scenario: Default database created on first run

- **WHEN** the server starts without `MOCK_DB_FILE` set and no `mocks.db` exists in the project root
- **THEN** the server creates `./mocks.db`, starts normally, and mock state is written to it

#### Scenario: Override redirects all state

- **WHEN** the server starts with `MOCK_DB_FILE=custom/mocks.db` and mocks are registered
- **THEN** the state is stored in the custom database and the default file is not created or modified

### Requirement: Fail fast on an unusable database

When the database file cannot be created or opened at the resolved path — for example a parent directory that does not exist or insufficient permissions — the server SHALL refuse to start and SHALL print an error identifying the database path.

#### Scenario: Unopenable database path

- **WHEN** the server starts with `MOCK_DB_FILE` pointing into a directory that does not exist
- **THEN** startup fails with an error naming the database path, and the server does not listen
