# Design

## Context

See proposal.md — Why. Current state: `readConfigEntries` (lib/config.ts) parses the file and rejects anything that is not a JSON array with `expected a JSON array of mock definitions`; entries then flow through `validateMockDefinition`, which is the single validation authority (design D5) and already knows both schema fields. `ajv` is a runtime dependency (from add-mock-body-schema), usable in tests at no cost. The repo sample `mocks.json` currently holds five demo entries in array form.

## Goals / Non-Goals

**Goals:**

- Editor autocomplete and inline errors for config authors, with zero editor configuration for the shipped sample (self-referencing `$schema`).
- Loader accepts the wrapper form with the same fail-fast semantics and error messages as the array form.
- The published schema provably agrees with the shipped sample (drift guard).

**Non-Goals:**

- Runtime validation against `mocks.schema.json` (proposal Non-goals) — `validateMockDefinition` stays authoritative.
- Generating the schema from TypeScript types; keeping generation plumbing for one hand-written file is not worth it.

## Decisions

### D32 — Wrapper form alongside the array, never replacing it

The loader accepts `{ "$schema"?: string, "mocks": MockDefinition[] }` in addition to the bare array. An array root cannot carry `$schema`, and the wrapper is the only way a config file can self-reference its schema for editors without per-workspace `json.schemas` mappings. Alternatives considered: (a) editor-mapping documentation only — rejected: nobody configures it, the feature dies in a README section; (b) replacing the array form — rejected: breaking change to every existing config and to the Docker mount flow for zero extra capability. Detection is trivial: `Array.isArray(parsed)` → array form; plain object → wrapper; anything else → existing "expected a JSON array" error, reworded to name both accepted forms.

### D33 — Strict wrapper keys: `$schema` and `mocks`, nothing else

Unknown keys (e.g. a typo'd `"mock"`) fail startup with a ConfigError naming the file. Silent-ignore would seed zero mocks from a file that looks fine — the worst failure mode for a fail-fast config surface (same philosophy as D6). `$schema` is accepted but never resolved, fetched, or validated at runtime (spec scenario pins this): editors consume it; the server ignores its value. A non-string `$schema` is a wrapper violation like any unknown/mistyped key.

### D34 — Schema file: hand-written draft 2020-12, `$defs`-shared entry, drift-guarded by test

`mocks.schema.json` uses `$defs.entry` for the mock-definition shape (method enum, `^/`-pattern uri, status 100–599, headers `additionalProperties: {type: string}`, free-form `body`, `bodySchema`/`responseSchema` as `{type: object}` with a `not: {required: [body, responseSchema]}`-style exclusion at entry level) and a root `oneOf: [entry[], wrapper]` with `additionalProperties: false` on the wrapper. Deliberately looser than `validateMockDefinition` where precision buys nothing in an editor (e.g. no wildcard-position rule for `uri`, no "compilable schema" check for the two schema fields — JSON Schema cannot express "generates successfully"): the runtime validator remains the strict authority, the schema file steers authoring. Drift guard: one vitest test compiles `mocks.schema.json` with the existing ajv dependency and validates (1) the shipped `mocks.json`, (2) a minimal array-form sample, (3) rejects a wrapper with an unknown key — so the published schema cannot silently diverge from what the loader accepts.

### D35 — Sample config switches to the wrapper form

The repo's `mocks.json` becomes `{"$schema": "./mocks.schema.json", "mocks": [ …same five entries… ]}`: dogfoods the new form, gives repo editors autocomplete immediately, and exercises the wrapper through `predev`/`prestart`/Docker seed on every run. The Docker image copies `mocks.json` as before; nothing in the image flow reads `$schema`, and the schema file ships alongside it harmlessly (copy it in the Dockerfile only if the build's file list is explicit — check during apply; do not add a COPY line speculatively).

## Risks / Trade-offs

- [Schema file and validator drift as fields evolve] → drift-guard test pins sample-vs-schema; the schema's `$comment` header notes "validateMockDefinition is authoritative — update both".
- [Wrapper form doubles the loader's parse branches] → one `Array.isArray` fork plus a small key check; entry handling is shared, so no duplicated validation paths.
- [Users hand-editing `$schema` to a wrong path get no runtime warning] → by design (D33): runtime resolution is a non-goal; a wrong path only degrades editor support.

## Migration Plan

1. Land schema file + loader branch + tests together (array form untouched, so existing configs are unaffected).
2. Switch the sample `mocks.json` last within the same change; `check-mocks` and the Docker seed exercise it immediately.
3. Rollback: revert the loader branch; wrapper-form files then fail fast with the existing "not an array" error — no data migration exists to undo.
