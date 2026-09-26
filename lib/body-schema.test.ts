import { describe, expect, it } from 'vitest';
import { compileBodySchema, validateBody } from './body-schema.ts';
import type { Json } from './types.ts';

const schema: Json = {
  type: 'object',
  required: ['name'],
  properties: { name: { type: 'string' }, age: { type: 'integer' } },
};

describe('compileBodySchema', () => {
  it('accepts a valid schema object', () => {
    expect(compileBodySchema(schema)).toBeNull();
  });

  it('rejects non-object schemas', () => {
    for (const bad of ['nope', 42, null, true, [{ type: 'object' }]]) {
      expect(compileBodySchema(bad), JSON.stringify(bad)).toMatch(/must be a JSON object/);
    }
  });

  it('rejects an invalid schema naming the ajv problem', () => {
    expect(compileBodySchema({ type: 'nope' })).toMatch(/not a valid JSON Schema/);
  });
});

describe('validateBody', () => {
  it('returns null for a conforming body', () => {
    expect(validateBody(schema, JSON.stringify({ name: 'x', age: 3 }))).toBeNull();
  });

  it('reports a wrong-typed property with its instance path', () => {
    const violations = validateBody(schema, JSON.stringify({ name: 42 }));
    expect(violations).toContainEqual({ field: '/name', message: 'must be string' });
  });

  it('reports a missing required property at its own path', () => {
    const violations = validateBody(schema, JSON.stringify({ age: 3 }));
    expect(violations?.some((v) => v.field === '/name' && /required/.test(v.message))).toBe(true);
  });

  it('reports every violation at once (allErrors)', () => {
    const violations = validateBody(schema, JSON.stringify({ name: 42, age: 'old' }));
    expect(violations?.map((v) => v.field).sort()).toEqual(['/age', '/name']);
  });

  it('rejects an absent or empty body with a single root-level violation', () => {
    for (const bodyText of [null, '']) {
      const violations = validateBody(schema, bodyText);
      expect(violations, JSON.stringify(bodyText)).toHaveLength(1);
      expect(violations?.[0].field).toBe('');
      expect(violations?.[0].message).toMatch(/absent or empty/);
    }
  });

  it('rejects a malformed JSON body with a single root-level violation', () => {
    const violations = validateBody(schema, '{not json');
    expect(violations).toEqual([{ field: '', message: 'request body must be valid JSON' }]);
  });

  it('compiles each distinct schema only once (cache hit)', () => {
    const cacheKey = '__mockE2eServerBodySchemaValidators';
    const validators = (globalThis as Record<string, unknown>)[cacheKey] as Map<string, unknown>;
    // A schema no earlier test compiled: first use grows the cache by one,
    // the structurally identical copy must hit the cache instead.
    const fresh: Json = { type: 'object', properties: { unique: { type: 'string' } } };
    const copy: Json = JSON.parse(JSON.stringify(fresh)) as Json;
    const before = validators.size;
    expect(validateBody(fresh, '{"unique":"a"}')).toBeNull();
    expect(validateBody(copy, '{"unique":"b"}')).toBeNull();
    expect(validators.size).toBe(before + 1);
  });
});
