import { readFileSync } from 'node:fs';
import Ajv2020, { type ValidateFunction } from 'ajv/dist/2020.js';
import { beforeAll, describe, expect, it } from 'vitest';

// Drift guard (design D34): the published editor schema must keep agreeing
// with what the loader accepts and what the repo ships. validateMockDefinition
// stays the runtime authority; this suite only pins schema-vs-sample drift.
const read = <T>(name: string): T =>
  JSON.parse(readFileSync(new URL(`../${name}`, import.meta.url), 'utf8')) as T;

let validate: ValidateFunction;

beforeAll(() => {
  validate = new Ajv2020({ strict: false }).compile(read<Record<string, unknown>>('mocks.schema.json'));
});

describe('mocks.schema.json drift guard', () => {
  it('accepts the shipped mocks.json', () => {
    expect(validate(read('mocks.json')), JSON.stringify(validate.errors)).toBe(true);
  });

  it('accepts a minimal bare-array config', () => {
    expect(validate([{ method: 'GET', uri: '/x' }])).toBe(true);
  });

  it('accepts a wrapper config with $schema', () => {
    expect(
      validate({
        $schema: './mocks.schema.json',
        mocks: [{ method: 'POST', uri: '/orders', status: 201, bodySchema: { type: 'object' } }],
      }),
    ).toBe(true);
  });

  it('rejects a wrapper carrying an unknown key', () => {
    expect(validate({ mocks: [], extra: 1 })).toBe(false);
  });

  it('rejects an entry combining body and responseSchema', () => {
    expect(
      validate([{ method: 'GET', uri: '/x', body: { a: 1 }, responseSchema: { type: 'object' } }]),
    ).toBe(false);
  });
});
