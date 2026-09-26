import { describe, expect, it } from 'vitest';
import { isReservedPath, validateMockDefinition } from './validation.ts';

function errorsOf(input: unknown): { field: string; message: string }[] {
  const result = validateMockDefinition(input);
  expect(result.ok).toBe(false);
  return result.ok ? [] : result.errors;
}

describe('validateMockDefinition — acceptance', () => {
  it('accepts a full definition and normalizes method case', () => {
    const result = validateMockDefinition({
      method: 'get',
      uri: '/users/:id',
      status: 404,
      headers: { 'X-Trace': 'abc' },
      body: { ok: false },
    });
    expect(result).toEqual({
      ok: true,
      value: {
        method: 'GET',
        uri: '/users/:id',
        status: 404,
        headers: { 'X-Trace': 'abc' },
        body: { ok: false },
      },
    });
  });

  it('accepts a minimal definition without optional fields', () => {
    const result = validateMockDefinition({ method: 'DELETE', uri: '/orders/1' });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toEqual({ method: 'DELETE', uri: '/orders/1' });
      expect('status' in result.value).toBe(false);
    }
  });

  it('accepts every allowed HTTP method', () => {
    for (const method of ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS']) {
      expect(validateMockDefinition({ method, uri: '/x' }).ok).toBe(true);
    }
  });

  it('accepts any JSON body value: object, array, string, number, boolean, null', () => {
    for (const body of [{ a: [1, { b: null }] }, [1, 2], 'text', 42, true, false, null]) {
      const result = validateMockDefinition({ method: 'GET', uri: '/x', body });
      expect(result.ok).toBe(true);
      if (result.ok) expect(result.value.body).toEqual(body);
    }
  });

  it('accepts a trailing wildcard and a bare root uri', () => {
    expect(validateMockDefinition({ method: 'GET', uri: '/files/*' }).ok).toBe(true);
    expect(validateMockDefinition({ method: 'GET', uri: '/' }).ok).toBe(true);
  });

  it('accepts a valid bodySchema and round-trips it into the value', () => {
    const bodySchema = {
      type: 'object',
      required: ['name'],
      properties: { name: { type: 'string' } },
    };
    const result = validateMockDefinition({ method: 'POST', uri: '/orders', bodySchema });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.bodySchema).toEqual(bodySchema);
  });

  it('omits bodySchema from the value when not declared', () => {
    const result = validateMockDefinition({ method: 'GET', uri: '/x' });
    expect(result.ok).toBe(true);
    if (result.ok) expect('bodySchema' in result.value).toBe(false);
  });

  it('accepts a valid responseSchema and round-trips it into the value', () => {
    const responseSchema = {
      type: 'object',
      required: ['id'],
      properties: { id: { type: 'integer' } },
    };
    const result = validateMockDefinition({ method: 'GET', uri: '/users/:id', responseSchema });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.responseSchema).toEqual(responseSchema);
  });

  it('omits responseSchema from the value when not declared', () => {
    const result = validateMockDefinition({ method: 'GET', uri: '/x' });
    expect(result.ok).toBe(true);
    if (result.ok) expect('responseSchema' in result.value).toBe(false);
  });

  it('accepts bodySchema and responseSchema together (request validation plus generated response)', () => {
    const result = validateMockDefinition({
      method: 'POST',
      uri: '/orders',
      bodySchema: { type: 'object', required: ['name'], properties: { name: { type: 'string' } } },
      responseSchema: { type: 'object', required: ['ok'], properties: { ok: { type: 'boolean' } } },
    });
    expect(result.ok).toBe(true);
  });
});

describe('validateMockDefinition — rejection', () => {
  it('rejects non-object payloads naming the payload field', () => {
    for (const payload of [null, 'nope', 42, [{ method: 'GET', uri: '/x' }]]) {
      const errors = errorsOf(payload);
      expect(errors.some((e) => e.field === 'payload')).toBe(true);
    }
  });

  it('rejects missing method with an error naming method', () => {
    const errors = errorsOf({ uri: '/ping' });
    expect(errors).toEqual([{ field: 'method', message: 'method is required' }]);
  });

  it('rejects unknown or non-string methods', () => {
    expect(errorsOf({ method: 'FETCH', uri: '/x' })[0].field).toBe('method');
    expect(errorsOf({ method: 7, uri: '/x' })[0].field).toBe('method');
  });

  it('rejects uri problems: missing, non-string, no leading slash', () => {
    expect(errorsOf({ method: 'GET' }).some((e) => e.field === 'uri' && /required/.test(e.message))).toBe(true);
    expect(errorsOf({ method: 'GET', uri: 5 })[0].message).toMatch(/string/);
    expect(errorsOf({ method: 'GET', uri: 'health' })[0].message).toMatch(/start with "\/"/);
  });

  it('rejects uris on the reserved admin prefix', () => {
    for (const uri of ['/_mocks', '/_mocks/anything', '/_mocks/']) {
      const errors = errorsOf({ method: 'GET', uri });
      expect(errors.some((e) => e.field === 'uri' && /reserved/.test(e.message))).toBe(true);
    }
  });

  it('rejects a wildcard that is not the final segment', () => {
    const errors = errorsOf({ method: 'GET', uri: '/*/tail' });
    expect(errors.some((e) => e.field === 'uri' && /final path segment/.test(e.message))).toBe(true);
  });

  it('rejects out-of-range, fractional, and non-number status', () => {
    for (const status of [99, 600, 200.5, '200', null]) {
      expect(errorsOf({ method: 'GET', uri: '/x', status })[0].field).toBe('status');
    }
  });

  it('rejects malformed headers', () => {
    expect(errorsOf({ method: 'GET', uri: '/x', headers: 'nope' })[0].field).toBe('headers');
    expect(errorsOf({ method: 'GET', uri: '/x', headers: ['a'] })[0].field).toBe('headers');
    const errors = errorsOf({ method: 'GET', uri: '/x', headers: { 'X-A': 3 } });
    expect(errors[0].field).toBe('headers');
    expect(errors[0].message).toContain('X-A');
  });

  it('rejects non-JSON body values', () => {
    expect(errorsOf({ method: 'GET', uri: '/x', body: () => {} })[0].field).toBe('body');
    expect(errorsOf({ method: 'GET', uri: '/x', body: { nested: Symbol('s') } })[0].field).toBe('body');
  });

  it('rejects a bodySchema that is not a JSON object', () => {
    for (const bodySchema of ['nope', 42, null, [{ type: 'object' }]]) {
      const errors = errorsOf({ method: 'GET', uri: '/x', bodySchema });
      expect(errors[0].field, JSON.stringify(bodySchema)).toBe('bodySchema');
      expect(errors[0].message).toMatch(/must be a JSON object/);
    }
  });

  it('rejects an invalid JSON Schema in bodySchema', () => {
    const errors = errorsOf({ method: 'GET', uri: '/x', bodySchema: { type: 'nope' } });
    expect(errors[0].field).toBe('bodySchema');
    expect(errors[0].message).toMatch(/not a valid JSON Schema/);
  });

  it('rejects a responseSchema that is not a JSON object', () => {
    for (const responseSchema of ['nope', 42, null, [{ type: 'object' }]]) {
      const errors = errorsOf({ method: 'GET', uri: '/x', responseSchema });
      expect(errors[0].field, JSON.stringify(responseSchema)).toBe('responseSchema');
      expect(errors[0].message).toMatch(/must be a JSON object/);
    }
  });

  it('rejects an invalid or unsupported responseSchema via trial generation', () => {
    const invalid = errorsOf({ method: 'GET', uri: '/x', responseSchema: { type: 'nope' } });
    expect(invalid[0].field).toBe('responseSchema');
    expect(invalid[0].message).toMatch(/not a valid JSON Schema/);

    const badVersion = errorsOf({
      method: 'GET',
      uri: '/x',
      responseSchema: { $schema: 'http://json-schema.org/draft-04/schema#', type: 'object' },
    });
    expect(badVersion[0].field).toBe('responseSchema');
    expect(badVersion[0].message).toMatch(/Unsupported JSON Schema version/);
  });

  it('rejects a definition combining body and responseSchema, naming both fields', () => {
    const errors = errorsOf({
      method: 'GET',
      uri: '/x',
      body: { static: true },
      responseSchema: { type: 'object' },
    });
    const conflict = errors.find((e) => /cannot be combined/.test(e.message));
    expect(conflict?.field).toBe('responseSchema');
    expect(conflict?.message).toContain('body');
    expect(conflict?.message).toContain('responseSchema');
  });

  it('collects multiple field errors at once', () => {
    const errors = errorsOf({ status: 'high', headers: 1 });
    const fields = errors.map((e) => e.field).sort();
    expect(fields).toEqual(['headers', 'method', 'status', 'uri']);
  });
});

describe('isReservedPath', () => {
  it('matches the prefix itself and subpaths but not lookalikes', () => {
    expect(isReservedPath('/_mocks')).toBe(true);
    expect(isReservedPath('/_mocks/abc')).toBe(true);
    expect(isReservedPath('/_mocksfoo')).toBe(false);
    expect(isReservedPath('/health')).toBe(false);
  });
});
