import { describe, expect, it } from 'vitest';
import { generateFromSchema } from './body-gen.ts';
import type { Json } from './types.ts';

const schema: Json = {
  type: 'object',
  required: ['id', 'name'],
  properties: {
    id: { type: 'integer' },
    name: { type: 'string' },
    tags: { type: 'array', items: { type: 'string' } },
  },
};

describe('generateFromSchema', () => {
  it('generates values conforming to the declared types', () => {
    const value = generateFromSchema(schema) as { id: number; name: string };
    expect(Number.isInteger(value.id)).toBe(true);
    expect(typeof value.name).toBe('string');
  });

  it('generates fresh data on consecutive calls', () => {
    const outputs = new Set<string>();
    for (let i = 0; i < 5; i++) {
      outputs.add(JSON.stringify(generateFromSchema(schema)));
    }
    expect(outputs.size).toBeGreaterThan(1);
  });

  it('honors enum constraints', () => {
    expect(generateFromSchema({ type: 'string', enum: ['only'] })).toBe('only');
  });

  it('throws for an invalid type keyword', () => {
    expect(() => generateFromSchema({ type: 'nope' })).toThrowError(/unknown primitive/);
  });

  it('throws for an unsupported $schema version', () => {
    expect(() =>
      generateFromSchema({ $schema: 'http://json-schema.org/draft-04/schema#', type: 'object' }),
    ).toThrowError(/Unsupported JSON Schema version/);
  });

  it('accepts declared 2020-12 and 2019-09 $schema versions', () => {
    const value = generateFromSchema({
      $schema: 'https://json-schema.org/draft/2020-12/schema',
      type: 'integer',
    });
    expect(typeof value).toBe('number');
    expect(typeof generateFromSchema({
      $schema: 'https://json-schema.org/draft/2019-09/schema',
      type: 'string',
    })).toBe('string');
  });
});
