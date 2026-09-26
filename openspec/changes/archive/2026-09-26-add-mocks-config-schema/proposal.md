# Proposal

## Why

Config authors get no editor support for `mocks.json`: the format — now spanning seven fields including two JSON Schema fields — lives only in README prose and in startup errors. Publishing a JSON Schema for the config file gives autocomplete, hover docs, and inline validation in every mainstream editor. One structural blocker: `mocks.json` is a bare JSON array, and an array root cannot carry a `$schema` key, so files cannot point editors at the schema without per-workspace configuration.

## What Changes

- Ship `mocks.schema.json` (draft 2020-12) at the repo root describing mock entries — `method`, `uri`, `status`, `headers`, `body`, `bodySchema`, `responseSchema`, including the `body`/`responseSchema` mutual exclusion — and a root that accepts **both** accepted file forms.
- The config loader additionally accepts an object wrapper form: `{ "$schema": "./mocks.schema.json", "mocks": [ ...entries ] }`. The bare-array form stays valid forever; both forms seed and validate identically. A wrapper carrying keys other than `$schema` and `mocks` fails startup like any invalid config.
- The repo's sample `mocks.json` switches to the wrapper form with a `$schema` key, so the shipped file has autocomplete out of the box and dogfoods the new form.
- A drift-guard test validates the sample config against `mocks.schema.json` using ajv (already a dependency), so the published schema cannot silently diverge from the shipped sample.
- README documents both forms and the autocomplete setup.

## Capabilities

### New Capabilities

(none)

### Modified Capabilities

- `mock-config`: the loader SHALL accept an object wrapper (`$schema` optional, `mocks` required array, no other keys) in addition to the bare array; both forms validate and seed identically, and invalid wrappers fail fast naming the file.

## Non-goals

- **No runtime validation against `mocks.schema.json`** — `validateMockDefinition` remains the single validation authority (better errors: entry index, field names); running both would create two sources of truth that can disagree.
- No breaking format change: bare arrays remain valid; no migration for existing user configs.
- No serving the schema over HTTP and no schema-store publication.
- No JSON Schema generation from TypeScript types (schema is hand-written and drift-guarded by test).

## Impact

- `mocks.schema.json` (new), `lib/config.ts` (+ `lib/config.test.ts`), `mocks.json`, README. The prestart gate and Docker seed flow pick the wrapper form up automatically since they share the loader. `mock-container`/`mock-admin-api` unaffected.
