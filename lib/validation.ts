import { generateFromSchema } from './body-gen.ts';
import { compileBodySchema } from './body-schema.ts';
import { HTTP_METHODS, RESERVED_PREFIX, type HttpMethod, type Json } from './types.ts';

export interface MockDefinition {
  method: HttpMethod;
  uri: string;
  status?: number;
  headers?: Record<string, string>;
  body?: Json;
  bodySchema?: Json;
  responseSchema?: Json;
}

export interface ValidationError {
  field: string;
  message: string;
}

export type ValidationResult =
  | { ok: true; value: MockDefinition }
  | { ok: false; errors: ValidationError[] };

/** True for the reserved admin prefix itself and any path below it. */
export function isReservedPath(path: string): boolean {
  return path === RESERVED_PREFIX || path.startsWith(RESERVED_PREFIX + '/');
}

function isJsonValue(value: unknown): boolean {
  if (value === null) return true;
  const t = typeof value;
  if (t === 'string' || t === 'number' || t === 'boolean') return true;
  if (Array.isArray(value)) return value.every(isJsonValue);
  if (t === 'object') {
    return Object.values(value as Record<string, unknown>).every(isJsonValue);
  }
  return false;
}

/**
 * Validates one mock definition (admin API payload or config-file entry).
 * Shared by both surfaces per design D5 so the rules never drift.
 */
export function validateMockDefinition(input: unknown): ValidationResult {
  if (typeof input !== 'object' || input === null || Array.isArray(input)) {
    return {
      ok: false,
      errors: [{ field: 'payload', message: 'mock definition must be a JSON object' }],
    };
  }
  const raw = input as Record<string, unknown>;
  const errors: ValidationError[] = [];

  let method: HttpMethod | undefined;
  if (raw.method === undefined) {
    errors.push({ field: 'method', message: 'method is required' });
  } else if (typeof raw.method !== 'string') {
    errors.push({ field: 'method', message: 'method must be a string' });
  } else {
    const upper = raw.method.toUpperCase();
    if ((HTTP_METHODS as readonly string[]).includes(upper)) {
      method = upper as HttpMethod;
    } else {
      errors.push({
        field: 'method',
        message: `method must be one of: ${HTTP_METHODS.join(', ')}`,
      });
    }
  }

  let uri: string | undefined;
  if (raw.uri === undefined) {
    errors.push({ field: 'uri', message: 'uri is required' });
  } else if (typeof raw.uri !== 'string') {
    errors.push({ field: 'uri', message: 'uri must be a string' });
  } else if (!raw.uri.startsWith('/')) {
    errors.push({ field: 'uri', message: 'uri must start with "/"' });
  } else if (isReservedPath(raw.uri)) {
    errors.push({
      field: 'uri',
      message: `uri must not use the reserved admin prefix ${RESERVED_PREFIX}`,
    });
  } else {
    const segments = raw.uri.split('/').filter((s) => s !== '');
    const wildcard = segments.indexOf('*');
    if (wildcard !== -1 && wildcard !== segments.length - 1) {
      errors.push({
        field: 'uri',
        message: 'wildcard "*" is only allowed as the final path segment',
      });
    } else {
      uri = raw.uri;
    }
  }

  let status: number | undefined;
  if (raw.status !== undefined) {
    if (
      typeof raw.status !== 'number' ||
      !Number.isInteger(raw.status) ||
      raw.status < 100 ||
      raw.status > 599
    ) {
      errors.push({ field: 'status', message: 'status must be an integer between 100 and 599' });
    } else {
      status = raw.status;
    }
  }

  let headers: Record<string, string> | undefined;
  if (raw.headers !== undefined) {
    if (typeof raw.headers !== 'object' || raw.headers === null || Array.isArray(raw.headers)) {
      errors.push({
        field: 'headers',
        message: 'headers must be an object mapping header names to string values',
      });
    } else {
      const entries = Object.entries(raw.headers as Record<string, unknown>);
      const invalid = entries.find(([, value]) => typeof value !== 'string');
      if (invalid) {
        errors.push({ field: 'headers', message: `header "${invalid[0]}" must be a string value` });
      } else {
        headers = Object.fromEntries(entries) as Record<string, string>;
      }
    }
  }

  let body: Json | undefined;
  if (raw.body !== undefined) {
    if (!isJsonValue(raw.body)) {
      errors.push({ field: 'body', message: 'body must be a JSON value' });
    } else {
      body = raw.body as Json;
    }
  }

  let bodySchema: Json | undefined;
  if (raw.bodySchema !== undefined) {
    const problem = compileBodySchema(raw.bodySchema);
    if (problem !== null) {
      errors.push({ field: 'bodySchema', message: problem });
    } else {
      bodySchema = raw.bodySchema as Json;
    }
  }

  let responseSchema: Json | undefined;
  if (raw.responseSchema !== undefined) {
    if (
      typeof raw.responseSchema !== 'object' ||
      raw.responseSchema === null ||
      Array.isArray(raw.responseSchema)
    ) {
      errors.push({ field: 'responseSchema', message: 'responseSchema must be a JSON object' });
    } else {
      // Trial generation is the validity check (design D28): an invalid or
      // unsatisfiable schema throws here, never at request time.
      try {
        generateFromSchema(raw.responseSchema as Json);
        responseSchema = raw.responseSchema as Json;
      } catch (err) {
        errors.push({
          field: 'responseSchema',
          message: `responseSchema is not a valid JSON Schema: ${
            err instanceof Error ? err.message : String(err)
          }`,
        });
      }
    }
  }

  if (raw.body !== undefined && raw.responseSchema !== undefined) {
    errors.push({
      field: 'responseSchema',
      message: 'body and responseSchema cannot be combined: serve a static body or a generated one',
    });
  }

  if (errors.length > 0) return { ok: false, errors };
  const value: MockDefinition = {
    method: method as HttpMethod,
    uri: uri as string,
  };
  if (status !== undefined) value.status = status;
  if (headers !== undefined) value.headers = headers;
  if (body !== undefined) value.body = body;
  if (bodySchema !== undefined) value.bodySchema = bodySchema;
  if (responseSchema !== undefined) value.responseSchema = responseSchema;
  return { ok: true, value };
}
