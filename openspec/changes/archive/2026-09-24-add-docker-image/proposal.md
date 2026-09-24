# Proposal

## Why

Running the mock server today requires Node >= 22.5 and `npm install` on the host. A container image lets any local E2E stack start the server with one command on machines without Node, and is the stepping stone to CI/CD service use later.

## What Changes

- Enable Next.js `output: 'standalone'` in `next.config.ts` so the build produces a self-contained server bundle for the image runtime stage.
- Add a multi-stage `Dockerfile`: a build stage (`npm ci`, `next build`) and a runtime stage (`node:26-alpine`, non-root `node` user, `CMD ["node", "server.js"]`).
- Bake container defaults as image env: `HOSTNAME=0.0.0.0` (container runtimes set `HOSTNAME` to the container id, which the standalone server would otherwise bind to), `PORT=3000`, `MOCK_DB_FILE=/data/mocks.db`, `NEXT_TELEMETRY_DISABLED=1`.
- Create `/data` owned by the runtime user so the SQLite database works with no volume (container-ephemeral state) and a named volume mounted at `/data` persists mocks across container recreation.
- Ship the sample `mocks.json` inside the image so a fresh container seeds the demo mocks; a custom config is mountable or pointed at via `MOCK_CONFIG_FILE`.
- Add a container `HEALTHCHECK` probing `GET /_mocks` — always available and spec-excluded from call statistics, unlike the mock-data `/health`, which disappears after clear-all.
- Add `.dockerignore` (node_modules, .next, .git, mocks.db*, build info, .omp).
- README: Docker section — build, run, persistence, custom config, rootless-podman bind-mount caveat (`--userns=keep-id`), and smoke verification against a running container.

Server behavior is unchanged: routing, admin API, store, config, and stats requirements hold as specced. Fail-fast startup (invalid config, unusable database) works inside the container exactly as specced — the container exits non-zero with the error naming the path.

## Capabilities

### New Capabilities
- `mock-container`: building and running the mock server as a container image — one-command startup without host Node, listen conventions (`PORT`, bind on all interfaces), SQLite state ephemeral by default and persistent via an optional volume, config seeded from the image or mounted, health probe, non-root runtime.

### Modified Capabilities

None — existing capabilities keep their requirements; the container consumes the already-specced `MOCK_DB_FILE` / `MOCK_CONFIG_FILE` overrides without changing them.

## Non-goals

- No docker-compose file, registry publishing, or CI/CD pipeline integration (possible follow-up work).
- No multi-architecture image builds.
- No Kubernetes or testcontainers integration.
- No `instrumentation.ts` change: build-stage seeding is discarded with the builder stage, and an invalid config failing the image build is desirable gating.

## Impact

- Files: `next.config.ts` (one line), new `Dockerfile`, new `.dockerignore`, `README.md` (Docker section).
- Local verification uses podman 6.x behind the `docker` CLI; `npm run smoke` against a running container covers the lifecycle.
- `output: 'standalone'` additionally emits `.next/standalone/` in local builds; `npm start` is unaffected.
