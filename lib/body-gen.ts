import { createGeneratorSync, type JsonSchema } from 'json-schema-faker';
import type { Json } from './types.ts';

// String-keyed globalThis singleton so dev-mode HMR recompiles keep the
// generator and its auto-incrementing seed (same pattern as the mock store,
// design D11). Const string literal keeps the computed-key type legal.
const GENERATOR_KEY = '__mockE2eServerSchemaGenerator';

type SchemaGenerator = ReturnType<typeof createGeneratorSync>;
type GeneratorGlobal = { [GENERATOR_KEY]?: SchemaGenerator };

function getGenerator(): SchemaGenerator {
  const g = globalThis as GeneratorGlobal;
  // createGeneratorSync auto-increments its seed per call: every call
  // produces fresh data (design D27, user-chosen semantics).
  // failOnInvalidTypes and validateSchemaVersion make invalid or unsupported
  // schemas throw instead of silently substituting defaults (design D28).
  g[GENERATOR_KEY] ??= createGeneratorSync({
    failOnInvalidTypes: true,
    validateSchemaVersion: true,
  });
  return g[GENERATOR_KEY];
}

// ponytail: per-call generation, no caching — fresh data per call is the
// spec'd semantics; in-memory at test scale. Cache per mock id only if
// profiling ever says otherwise.
// Callers guarantee `schema` passed registration-time validation (D28),
// so it is always a JSON object here.
export function generateFromSchema(schema: Json): Json {
  return getGenerator().generate(schema as JsonSchema) as Json;
}
