# Tasks

## 1. Standalone build

- [x] 1.1 Add `output: 'standalone'` to `next.config.ts` (design D1); verify `npm run build` still succeeds, `.next/standalone/server.js` exists afterward, and `npm test` still passes.

## 2. Container image

- [x] 2.1 Create `.dockerignore` with `node_modules`, `.next`, `out`, `.git`, `.omp`, `openspec`, `mocks.db*`, `*.tsbuildinfo`, `.DS_Store` (design D9); verify the next build's context-transfer step no longer ships `node_modules`.
- [x] 2.2 Create the multi-stage `Dockerfile` per design D2–D8: `node:26-alpine` builder (`npm ci`, `NEXT_TELEMETRY_DISABLED=1`, `npm run build`); runtime stage copies `.next/standalone/` → `/app`, `.next/static/` → `/app/.next/static`, `mocks.json` → `/app/mocks.json`; `ENV HOSTNAME=0.0.0.0 PORT=3000 NODE_ENV=production MOCK_DB_FILE=/data/mocks.db`; `mkdir -p /data && chown node:node /data`; `USER node`; `EXPOSE 3000`; `HEALTHCHECK` via busybox `wget -qO- http://127.0.0.1:${PORT:-3000}/_mocks`; `CMD ["node", "server.js"]`. Verify `docker build -t mock-e2e-server:latest .` completes and record the image size.
- [x] 2.3 Verify build-time behavior per design D2: inspect build logs for a `[mocks] seeded` line (instrumentation `register()` at build time) and confirm the runtime image contains no baked database — `docker run --rm mock-e2e-server:latest ls /app /data` shows `server.js`, `.next`, `mocks.json` in `/app` and an empty `/data`; record the finding in the change notes.

## 3. Container runtime verification

- [x] 3.1 Start the container with `-p 3100:3000`; verify the built-in sample seeding works without host Node (`curl http://127.0.0.1:3100/health` returns the seeded demo response, `GET /_mocks` lists the two sample mocks) and the process is non-root (`docker exec <id> id -u` prints `1000`).
- [x] 3.2 Run `npm run smoke` against the container (default `MOCK_BASE=http://127.0.0.1:3100` matches the published port); verify the full lifecycle suite passes.
- [x] 3.3 Verify the `PORT` convention: start a container with `-e PORT=3100` and `-p 3200:3100`; verify the server answers on the published port inside the container.
- [x] 3.4 Verify health reporting: after `DELETE /_mocks` (clear-all), `docker inspect --format '{{.State.Health.Status}}' <id>` reports `healthy`, and `GET /_mocks/stats` contains no health-probe entries.
- [x] 3.5 Verify state lifecycle: with a named volume (`-v mockdata:/data`), register a mock, `docker rm -f` the container, start a new one on the same volume — the mock survives with its original id; without a volume, removal leaves a fresh container holding only the seeded mocks.
- [x] 3.6 Verify fail-fast in-container: (a) mount a malformed `mocks.json` over `/app/mocks.json` — container exits non-zero before listening and the log names the config path; (b) bind-mount a root-owned host dir at `/data` without `--userns=keep-id` — container exits non-zero and the log names the database path.
- [x] 3.7 Verify graceful shutdown: `time docker stop <id>` completes promptly (SIGTERM handled by `node server.js` as PID 1, design D6); if it hangs to the kill timeout, note it for the design's init-layer fallback.
- [x] 3.8 Verify mounted custom config: start a fresh-volume container with a valid custom config mounted read-only over `/app/mocks.json`; the custom entries are seeded and the image's sample entries are absent from `GET /_mocks`.

## 4. Documentation

- [x] 4.1 Add the README Docker section (proposal — What Changes): build, run with port publishing, persistence via named volume, custom config via mount or `MOCK_CONFIG_FILE`, rootless-podman caveats (`--userns=keep-id` for bind mounts; one container per data volume), and the smoke verification command; verify every documented command was executed verbatim in tasks 2–3 or run it once more as written.
