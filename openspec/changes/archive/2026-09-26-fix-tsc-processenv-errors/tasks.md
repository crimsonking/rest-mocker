# Tasks

## 1. Widen resolver signatures

- [x] 1.1 `lib/store.ts`: change `resolveDbPath(env: NodeJS.ProcessEnv = process.env, ...)` to `env: Record<string, string | undefined> = process.env`; verify `npx tsc --noEmit 2>&1 | grep store.test` is empty and `npx vitest run lib/store.test.ts` passes
- [x] 1.2 `lib/config.ts`: same change for `resolveConfigPath`; verify `npx tsc --noEmit 2>&1 | grep config.test` is empty and `npx vitest run lib/config.test.ts` passes
- [x] 1.3 `lib/stats.ts`: same change for `resolveCallerHeader`; verify `npx tsc --noEmit 2>&1 | grep stats.test` is empty and `npx vitest run lib/stats.test.ts` passes

## 2. Full gates

- [x] 2.1 `npx tsc --noEmit` exits 0 with zero errors (unfiltered); `npm test` passes with no new failures; `node scripts/check-mocks.ts` prints `config OK`
