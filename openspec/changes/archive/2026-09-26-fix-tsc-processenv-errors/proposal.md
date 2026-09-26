# Proposal

## Why

`npx tsc --noEmit` exits with 10 errors across `lib/store.test.ts`, `lib/config.test.ts`, and `lib/stats.test.ts`: the three env-resolver functions (`resolveDbPath`, `resolveConfigPath`, `resolveCallerHeader`) type their parameter as `NodeJS.ProcessEnv`, and `@types/node` 26 made `NODE_ENV` a required property of that type — so test call sites passing partial env literals (`{}`, `{ MOCK_DB_FILE: 'data/m.db' }`) no longer typecheck. The breakage predates the schema features but keeps the project's own type gate permanently red, which hides any new type error in known noise.

## What Changes

- Widen the `env` parameter type on the three resolvers from `NodeJS.ProcessEnv` to `Record<string, string | undefined>` — structurally exactly how the functions use it (single optional-key lookups). `process.env` stays assignable, so the default parameter and all production call sites are untouched.
- No runtime behavior change, no test rewrites, no dependency or tsconfig changes.

## Capabilities

### New Capabilities

(none)

### Modified Capabilities

(none — type-level fix with no observable behavior change; the change declares `skip_specs: true`.)

## Non-goals

- No changes to `tsconfig.json` strictness flags.
- No pinning, downgrading, or patching of `@types/node`.
- No refactor of the resolvers beyond the parameter type.

## Impact

- `lib/store.ts`, `lib/config.ts`, `lib/stats.ts` — one signature each. Gates: `npx tsc --noEmit` exits 0 (first clean run since the `@types/node` bump); `npm test` stays green; `node scripts/check-mocks.ts` unaffected.
