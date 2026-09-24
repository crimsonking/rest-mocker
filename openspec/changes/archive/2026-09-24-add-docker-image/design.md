# Design

## Context

See proposal.md — Why. Current state that shapes the approach:

- Next.js 15.5 App Router, route handlers only (no `page.tsx`; the catch-all is `force-dynamic`, `runtime = 'nodejs'`), so `next build` has little or nothing to prerender.
- State is SQLite via `node:sqlite` (`DatabaseSync`), requiring Node >= 22.5 (unflagged `node:sqlite` since 22.13). The store opens a single connection; the design assumes one process owns the DB file (`seq UNIQUE`).
- `resolveDbPath` / `resolveConfigPath` resolve relative env paths against `process.cwd()`; defaults `./mocks.db`, `./mocks.json`.
- `instrumentation.ts` seeds config-when-empty at startup and `process.exit(1)`s on invalid config or unusable DB (spec'd fail-fast). `scripts/check-mocks.ts` (the `predev`/`prestart` gate) runs the same loader.
- `MockStore.open()` does not create missing parent directories; failures name the DB path.
- Local container runtime is podman 6.1.2 behind the `docker` CLI (rootless); local Node is v26.8.2. `npm run smoke` exercises the full lifecycle against `MOCK_BASE` (default `http://127.0.0.1:3100`).
- Standalone `server.js` binds `process.env.HOSTNAME || '0.0.0.0'` and `process.env.PORT || 3000` (verified in `node_modules/next/dist/build/utils.js:1315-1316`). Container runtimes set `HOSTNAME` to the container id, so the fallback never fires in a container.

## Goals / Non-Goals

**Goals:**

- One-command local run (`docker build` + `docker run`) with zero host Node.js dependency.
- Runtime behavior identical to bare metal: all five existing capabilities hold unchanged.
- Small image (target: base alpine + ~50 MB traced app).
- The built image passes `npm run smoke` and a volume persistence cycle.

**Non-Goals:**

- Registry publishing, image tagging conventions, CI pipelines, compose files, multi-arch, Kubernetes (see proposal — Non-goals).
- Distroless hardening; alpine + non-root user is the security floor for this change.

## Decisions

- **D1 — `output: 'standalone'` in `next.config.ts`.** The runtime stage then carries only `server.js`, traced production dependencies, and the server build — no dev deps, no `next start`. Alternative: copy full `node_modules` and run `next start`; rejected — image bloat and dependency-pruning complexity. Side effect: local `npm run build` also emits `.next/standalone/`; `npm start` unaffected.
- **D2 — Multi-stage Dockerfile** (builder: `npm ci` + `next build`; runtime: copy `.next/standalone/` → `/app`, `.next/static/` → `/app/.next/static`, `mocks.json` → `/app/mocks.json`; no `public/` exists). Whether `instrumentation.register()` fires during `next build` is unconfirmed for this app and deliberately left un-investigated: with nothing to prerender the path may never trigger, and either way it is harmless — the builder's `mocks.db` is never copied, and an invalid config failing the build is desirable gating. Rejected alternative: `NEXT_PHASE` build guard in `instrumentation.ts` — unnecessary given multi-stage, and it would suppress the useful build-time config validation. **Apply finding (question closed):** `register()` does not fire during `next build` for this app — neither the host build nor the container build produced a `mocks.db` or a `[mocks] seeded` log line (nothing to prerender, so the instrumentation loader never loads); the runtime image contains no baked database and `/data` is empty.
- **D3 — Base image `node:26-alpine`** for both stages: parity with the dev host (v26.8.2) matters most for a test double; musl builds ship `node:sqlite` as core. Alternatives: `node:24-alpine` (active LTS — acceptable fallback), `node:22-alpine` (oldest supported, drifts from dev), distroless (no shell for healthcheck/debugging, no Node 26 line yet).
- **D4 — Bake `ENV HOSTNAME=0.0.0.0`**, plus `PORT=3000` (overridable) and `EXPOSE 3000`. Without it the server binds the container-id hostname's resolved IP — works with port publishing but fragile under `--network host` or custom `--hostname` (same rationale as Vercel's official with-docker example).
- **D5 — Data directory `/data`; bake `ENV MOCK_DB_FILE=/data/mocks.db`; `mkdir -p /data && chown node:node /data`.** Keeps the DB out of `/app` so a volume can never shadow application code. **No `VOLUME` instruction**: podman/docker leak anonymous volumes on every run without `--rm`, and `VOLUME` freezes the directory against later image writes. Default (no mount) = container-ephemeral state — right for a test tool; persistence is opt-in via a named volume, which inherits `/data`'s ownership from the image and is therefore writable under rootless podman. Rootless **bind** mounts are the caveat: the host user maps to container root by default, so `USER node` cannot write them — document `--userns=keep-id` or named volumes in the README.
- **D6 — Non-root `USER node` (uid 1000)**, granted write access to `/data`. CMD runs `node server.js` directly as PID 1 in exec form (signals reach Node without a shell wrapper); no tini/dumb-init — verify graceful stop at apply time and add an init layer only if SIGTERM handling proves wrong.
- **D7 — `HEALTHCHECK` probes `GET /_mocks` via busybox `wget`** (present in alpine; no curl install): `wget -qO- http://127.0.0.1:${PORT:-3000}/_mocks >/dev/null || exit 1`. Target rationale: `/health` is mock data — it disappears after clear-all and would kill healthy containers; `/_mocks` always answers 200 while the process is up and is spec-excluded from call statistics, so probes never pollute stats. Must be GET, not HEAD: the admin API returns 405 for unsupported methods, and `wget --spider` sends HEAD. **Apply finding:** podman builds OCI image format by default, which ignores `HEALTHCHECK` at build time; build with `--format docker` under podman to bake it in (the Docker CLI produces docker format by default, so the Dockerfile is canonical as written).
- **D8 — No entrypoint wrapper.** The `prestart` `check-mocks.ts` gate is redundant in-container: instrumentation runs the same loader and exits(1) before listening (D2, spec'd fail-fast). Fewer moving parts; error messages already name the offending path.
- **D9 — `.dockerignore`**: `node_modules`, `.next`, `out`, `.git`, `.omp`, `openspec`, `mocks.db*`, `*.tsbuildinfo`, `.DS_Store`. Source files (app/, lib/, tests, vitest config) stay in the build context — small, and test files are never traced into the runtime image.
- **D10 — Ship the repo's sample `mocks.json` at `/app/mocks.json`** so a fresh container reproduces the README quick-start experience (seeded `/health`, `/users/:id`). `WORKDIR /app` makes cwd-relative resolution land there; custom configs mount over it (read-only) or point elsewhere via `MOCK_CONFIG_FILE`.
- **D11 — Verification plan** (executed in the apply phase): `docker build` via podman; run with `-p 3100:3000` and `npm run smoke` (its default `MOCK_BASE` already targets 3100); named-volume persistence cycle (`rm` + recreate → mocks survive); no-volume ephemerality check; invalid-config mount → non-zero exit with path-naming log; unwritable-`/data` bind mount → DB-path error; `exec id -u` → 1000; `podman inspect` health status; record image size.

## Risks / Trade-offs

- [Standalone tracing misses the instrumentation's dynamic `import('./lib/config.ts')` chain, so seeding silently doesn't run in the image] → Smoke + first-run seeding check against the actual container during apply; Next's file tracing normally bundles instrumentation and its imports.
- [`node:sqlite` behaves differently on musl than on the glibc dev host] → Smoke run covers the store lifecycle; fallback to `node:26-bookworm-slim` if alpine misbehaves (D3 alternative).
- [Rootless podman bind-mounted `/data` fails fast with a permission error, confusing users] → Spec'd behavior (error names the DB path); README documents named volumes and `--userns=keep-id`.
- [HEALTHCHECK shell form depends on busybox `wget` flag support and `$PORT` expansion in the health probe shell] → Verified against the actual base image during apply.
- [`server.js` as PID 1 reaps nothing and could ignore SIGTERM] → Checked during apply (`podman stop` timing); mitigation is a one-line init layer if needed.
- [Two containers sharing one `/data` volume corrupt the single-writer assumption] → Out of scope to enforce technically; README states one container per data volume.

## Migration Plan

Purely additive: new `Dockerfile`, `.dockerignore`, README section, one-line `next.config.ts` change. No data migration. Rollback = delete the new files and revert the `output: 'standalone'` line; nothing else depends on them.

## Open Questions

- Image name/tag convention (and any registry) — only becomes real with CI/CD integration; deferrable without touching specs, approach, or tasks. Local builds use a repo-local tag (e.g. `mock-e2e-server:latest`).
