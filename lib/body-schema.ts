import Ajv2020, { type ErrorObject, type ValidateFunction } from 'ajv/dist/2020.js';
import type { Json } from './types.ts';

export interface BodySchemaViolation {
  field: string;
  message: string;
}

// String-keyed globalThis singletons so dev-mode HMR recompiles keep the Ajv
// instance and its compiled validators (same pattern as the mock store,
// design D11). Const string literals keep the computed-key types legal.
const AJV_KEY = '__mockE2eServerAjv';
const VALIDATORS_KEY = '__mockE2eServerBodySchemaValidators';

type AjvGlobal = { [AJV_KEY]?: Ajv2020 };
type ValidatorsGlobal = { [VALIDATORS_KEY]?: Map<string, ValidateFunction> };

function getAjv(): Ajv2020 {
  const g = globalThis as AjvGlobal;
  // strict:false — user-supplied schemas must not be rejected for ajv's
  // stylistic preferences; allErrors fills the details list (design D23).
  g[AJV_KEY] ??= new Ajv2020({ strict: false, allErrors: true, allowUnionTypes: true });
  return g[AJV_KEY];
}

// Compiled validators keyed by schema text, so each distinct schema compiles
// once per process (design D23).
// ponytail: unbounded cache — fine at test-scale mock counts; evict on
// clearAll if it ever measurably matters.
function getValidators(): Map<string, ValidateFunction> {
  const g = globalThis as ValidatorsGlobal;
  g[VALIDATORS_KEY] ??= new Map();
  return g[VALIDATORS_KEY];
}

/** Callers guarantee `schema` passed registration-time validation (D22/D24). */
function validatorFor(schema: Json): ValidateFunction {
  const key = JSON.stringify(schema);
  const validators = getValidators();
  let validate = validators.get(key);
  if (validate === undefined) {
    validate = getAjv().compile(schema as { [key: string]: unknown });
    validators.set(key, validate);
  }
  return validate;
}

/**
 * Registration-time schema check (design D22): returns null when `schema` is
 * a JSON object that compiles as a JSON Schema, otherwise a human-readable
 * rejection reason for the `bodySchema` field error.
 */
export function compileBodySchema(schema: unknown): string | null {
  if (typeof schema !== 'object' || schema === null || Array.isArray(schema)) {
    return 'bodySchema must be a JSON object';
  }
  try {
    validatorFor(schema as Json);
    return null;
  } catch (err) {
    return `bodySchema is not a valid JSON Schema: ${
      err instanceof Error ? err.message : String(err)
    }`;
  }
}

/**
 * Validates raw request body text against a registered bodySchema (design
 * D24). Returns null on success, otherwise violations whose `field` carries
 * the JSON Schema instance path. An absent, empty, or unparseable body is a
 * single root-level violation.
 */
export function validateBody(schema: Json, bodyText: string | null): BodySchemaViolation[] | null {
  if (bodyText === null || bodyText === '') {
    return [{ field: '', message: 'request body is required by bodySchema but was absent or empty' }];
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(bodyText);
  } catch {
    return [{ field: '', message: 'request body must be valid JSON' }];
  }
  const validate = validatorFor(schema);
  if (validate(parsed)) return null;
  return (validate.errors ?? []).map(violationOf);
}

function violationOf(error: ErrorObject): BodySchemaViolation {
  // ajv reports a missing required property on its parent; point `field` at
  // the absent property itself so details read like type violations do.
  const field =
    error.keyword === 'required' && typeof error.params.missingProperty === 'string'
      ? `${error.instancePath}/${error.params.missingProperty}`
      : error.instancePath;
  return { field, message: error.message ?? 'body failed schema validation' };
}
