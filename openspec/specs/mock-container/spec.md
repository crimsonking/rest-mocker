# mock-container Specification

## Purpose

Packages the mock server as a container image that any OCI runtime can build and run as a self-contained mock API service — with predictable listen conventions, optional durable state via a volume, startup seeding from a built-in or mounted config, health reporting, and a non-root runtime — requiring no Node.js installation on the host.

## Requirements

### Requirement: The image builds from the repository and serves mocks without host Node.js

Building the container image from a clean checkout SHALL succeed, and a container started from the image SHALL serve the full mock server behavior — routing, admin API, store, config seeding, and statistics — using only the image's own runtime, with no Node.js installation on the host.

#### Scenario: Build from a clean checkout

- **WHEN** the image is built from a clean checkout of the repository
- **THEN** the build completes successfully and produces a runnable image

#### Scenario: Container serves seeded and runtime mocks

- **WHEN** a container is started from the image with its port published and a client sends `GET /health`, then registers a mock via `POST /_mocks` and calls it
- **THEN** the seeded demo mock responds, and the runtime-registered mock responds exactly as defined, without any host-side build or install step

### Requirement: Predictable listen conventions

The container SHALL listen on all network interfaces on the port given by the `PORT` environment variable, defaulting to `3000`, regardless of the `HOSTNAME` value injected by the container runtime, so published ports and inter-container traffic reach the server.

#### Scenario: Published port reaches the server

- **WHEN** a container is started with its default port published to the host and a client on the host calls the mock server
- **THEN** the request is served

#### Scenario: PORT overrides the listen port

- **WHEN** a container is started with `PORT=3100` and its port 3100 published
- **THEN** the server listens inside the container on 3100 and serves requests arriving there

### Requirement: Mock state is container-ephemeral by default and durable with a volume

The image SHALL keep the mock database at a dedicated data directory (`/data`) so that, without a mounted volume, mock state lives and dies with the container, and with a named or host-provisioned writable volume mounted at that directory, mock state SHALL persist across container stop, removal, and recreation with the guarantees of the mock-store capability.

#### Scenario: State dies with an unmounted container

- **WHEN** mocks are registered in a container started without a volume and the container is removed and replaced by a new one from the same image
- **THEN** the new container's store holds only the config-seeded mocks, not the previously registered ones

#### Scenario: Volume persists state across recreation

- **WHEN** mocks are registered in a container with a named volume mounted at the data directory, the container is removed, and a new container from the same image is started with the same volume
- **THEN** all previously registered mocks are still listed and matched with their original ids

### Requirement: Startup seeding from built-in or mounted config

The image SHALL ship the repository's sample `mocks.json` so a first run against an empty store seeds the demo mocks, and SHALL accept a custom config file mounted into the container or selected via `MOCK_CONFIG_FILE`, honoring the mock-config capability's seed-when-empty and precedence rules unchanged.

#### Scenario: First run seeds the built-in sample

- **WHEN** a fresh container is started with an empty data directory
- **THEN** the sample mocks from the image are registered and matchable

#### Scenario: Mounted config replaces the sample

- **WHEN** a fresh container is started with a custom config file mounted over the built-in config path
- **THEN** the custom file's entries are seeded instead of the image's sample entries

### Requirement: Startup fail-fast is preserved in the container

When startup inputs are invalid — a config file that fails parsing or validation, or a database path that cannot be created or opened (for example a data directory the runtime user cannot write to) — the container SHALL exit with a non-zero status without ever listening, printing an error that names the offending file or database path.

#### Scenario: Invalid mounted config stops the container

- **WHEN** a container is started with a mounted config file containing malformed JSON
- **THEN** the container exits non-zero before listening and its log names the config file path

#### Scenario: Unwritable data directory stops the container

- **WHEN** a container is started with a data directory its runtime user cannot write to
- **THEN** the container exits non-zero before listening and its log names the database path

### Requirement: Health reporting independent of mock data

The image SHALL define a health check that reports the container healthy whenever the server process is up and answering admin API requests, and SHALL NOT depend on any registered mock existing; health probes SHALL NOT appear in call statistics.

#### Scenario: Healthy after clear-all

- **WHEN** all mocks are cleared via `DELETE /_mocks` and the runtime evaluates the container health
- **THEN** the container is still reported healthy

#### Scenario: Probes do not pollute statistics

- **WHEN** the health check has run several times and a client requests `GET /_mocks/stats`
- **THEN** no health-probe entry appears in the report

### Requirement: Non-root runtime

The server process inside the container SHALL run as a non-root user, and the image SHALL grant that user write access to the data directory.

#### Scenario: Process user is not root

- **WHEN** a container is started from the image and the server process's user is inspected
- **THEN** the process runs as a non-root user and the mock database file is created successfully
