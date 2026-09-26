import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
import { ConfigError, readConfigEntries, resolveConfigPath, seedStoreFromFile } from './config.ts';
import { MockStore } from './store.ts';

let dir: string;

function configFile(name: string, content: string): string {
  const file = path.join(dir, name);
  writeFileSync(file, content, 'utf8');
  return file;
}

beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), 'mock-config-'));
});

describe('resolveConfigPath', () => {
  it('defaults to mocks.json under cwd', () => {
    expect(resolveConfigPath({}, '/srv/app')).toBe('/srv/app/mocks.json');
  });

  it('honors MOCK_CONFIG_FILE, resolving relative paths against cwd', () => {
    expect(resolveConfigPath({ MOCK_CONFIG_FILE: 'conf/m.json' }, '/srv/app')).toBe(
      '/srv/app/conf/m.json',
    );
    expect(resolveConfigPath({ MOCK_CONFIG_FILE: '/abs/m.json' }, '/srv/app')).toBe('/abs/m.json');
  });
});

describe('readConfigEntries', () => {
  it('returns an empty list for a missing file', () => {
    expect(readConfigEntries(path.join(dir, 'absent.json'))).toEqual([]);
  });

  it('parses and normalizes a valid file preserving order', () => {
    const file = configFile(
      'valid.json',
      JSON.stringify([
        { method: 'get', uri: '/health', body: 'ok' },
        { method: 'POST', uri: '/echo', status: 201, headers: { 'X-H': 'v' }, body: { a: 1 } },
      ]),
    );
    expect(readConfigEntries(file)).toEqual([
      { method: 'GET', uri: '/health', body: 'ok' },
      { method: 'POST', uri: '/echo', status: 201, headers: { 'X-H': 'v' }, body: { a: 1 } },
    ]);
  });

  it('throws a ConfigError naming the file for malformed JSON', () => {
    const file = configFile('bad.json', '{not json');
    expect(() => readConfigEntries(file)).toThrowError(ConfigError);
    try {
      readConfigEntries(file);
    } catch (err) {
      expect((err as Error).message).toContain(file);
    }
  });

  it('throws when the top-level value is neither an array nor a wrapper', () => {
    const scalar = configFile('scalar.json', JSON.stringify('nope'));
    expect(() => readConfigEntries(scalar)).toThrowError(/expected a JSON array/);
    // A bare mock definition (array brackets forgotten) lands in the wrapper
    // branch and is reported by its unknown keys.
    const bareDef = configFile('obj.json', JSON.stringify({ method: 'GET', uri: '/x' }));
    expect(() => readConfigEntries(bareDef)).toThrowError(/unknown wrapper key/);
  });

  it('throws naming the file and the offending entry index', () => {
    const file = configFile(
      'invalid-entry.json',
      JSON.stringify([
        { method: 'GET', uri: '/a' },
        { method: 'GET', uri: '/b' },
        { method: 'FETCH', uri: '/c' },
      ]),
    );
    try {
      readConfigEntries(file);
      expect.unreachable('should have thrown');
    } catch (err) {
      const message = (err as Error).message;
      expect(message).toContain(file);
      expect(message).toContain('entry 2');
      expect(message).toContain('method');
    }
  });

  it('rejects reserved-prefix uris in config entries', () => {
    const file = configFile('reserved.json', JSON.stringify([{ method: 'GET', uri: '/_mocks/x' }]));
    expect(() => readConfigEntries(file)).toThrowError(/reserved/);
  });

  it('loads an entry with a valid bodySchema intact', () => {
    const bodySchema = {
      type: 'object',
      required: ['name'],
      properties: { name: { type: 'string' } },
    };
    const file = configFile(
      'schema.json',
      JSON.stringify([{ method: 'POST', uri: '/orders', body: { ok: true }, bodySchema }]),
    );
    expect(readConfigEntries(file)).toEqual([
      { method: 'POST', uri: '/orders', body: { ok: true }, bodySchema },
    ]);

    const store = new MockStore(':memory:');
    expect(seedStoreFromFile(file, store)).toEqual({ path: file, seeded: 1, skipped: 0 });
    expect(store.list()[0].bodySchema).toEqual(bodySchema);
  });

  it('throws naming the file and entry index for an invalid bodySchema', () => {
    const file = configFile(
      'bad-schema.json',
      JSON.stringify([
        { method: 'GET', uri: '/a' },
        { method: 'POST', uri: '/b', bodySchema: { type: 'nope' } },
      ]),
    );
    try {
      readConfigEntries(file);
      expect.unreachable('should have thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(ConfigError);
      const message = (err as Error).message;
      expect(message).toContain(file);
      expect(message).toContain('entry 1');
      expect(message).toContain('bodySchema');
    }
  });

  it('throws for a bodySchema that is not a JSON object', () => {
    const file = configFile(
      'schema-not-object.json',
      JSON.stringify([{ method: 'POST', uri: '/b', bodySchema: 'nope' }]),
    );
    expect(() => readConfigEntries(file)).toThrowError(/bodySchema/);
  });

  it('loads a wrapper-form config identically to the array form', () => {
    const entries = [
      { method: 'get', uri: '/health', body: 'ok' },
      { method: 'POST', uri: '/echo', status: 201, body: { a: 1 } },
    ];
    const arrayFile = configFile('form-array.json', JSON.stringify(entries));
    const wrapperFile = configFile(
      'form-wrapper.json',
      JSON.stringify({ $schema: './mocks.schema.json', mocks: entries }),
    );
    expect(readConfigEntries(wrapperFile)).toEqual(readConfigEntries(arrayFile));
  });

  it('throws naming the file and key for an unknown wrapper key', () => {
    const file = configFile('wrapper-unknown-key.json', JSON.stringify({ mocks: [], mock: [] }));
    try {
      readConfigEntries(file);
      expect.unreachable('should have thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(ConfigError);
      const message = (err as Error).message;
      expect(message).toContain(file);
      expect(message).toContain('mock');
    }
  });

  it('throws for a wrapper whose mocks is not an array', () => {
    const file = configFile('wrapper-bad-mocks.json', JSON.stringify({ mocks: 'nope' }));
    expect(() => readConfigEntries(file)).toThrowError(/"mocks" must be a JSON array/);
  });

  it('throws for a wrapper whose $schema is not a string', () => {
    const file = configFile('wrapper-bad-schema-key.json', JSON.stringify({ $schema: 42, mocks: [] }));
    expect(() => readConfigEntries(file)).toThrowError(/"\$schema" must be a string/);
  });

  it('never resolves $schema at runtime: an unreachable path loads fine', () => {
    const file = configFile(
      'wrapper-unreachable-schema.json',
      JSON.stringify({
        $schema: 'https://nonexistent.invalid/definitely-not-here.json',
        mocks: [{ method: 'GET', uri: '/x' }],
      }),
    );
    expect(readConfigEntries(file)).toEqual([{ method: 'GET', uri: '/x' }]);
  });

  it('throws naming the file and entry index for an invalid entry inside a wrapper', () => {
    const file = configFile(
      'wrapper-invalid-entry.json',
      JSON.stringify({
        mocks: [{ method: 'GET', uri: '/a' }, { method: 'FETCH', uri: '/b' }],
      }),
    );
    try {
      readConfigEntries(file);
      expect.unreachable('should have thrown');
    } catch (err) {
      const message = (err as Error).message;
      expect(message).toContain(file);
      expect(message).toContain('entry 1');
      expect(message).toContain('method');
    }
  });

  it('loads an entry with a valid responseSchema intact', () => {
    const responseSchema = {
      type: 'object',
      required: ['id'],
      properties: { id: { type: 'integer' } },
    };
    const file = configFile(
      'response-schema.json',
      JSON.stringify([{ method: 'GET', uri: '/users/:id', responseSchema }]),
    );
    expect(readConfigEntries(file)).toEqual([
      { method: 'GET', uri: '/users/:id', responseSchema },
    ]);

    const store = new MockStore(':memory:');
    expect(seedStoreFromFile(file, store)).toEqual({ path: file, seeded: 1, skipped: 0 });
    expect(store.list()[0].responseSchema).toEqual(responseSchema);
  });

  it('throws naming the file and entry index for an invalid responseSchema', () => {
    const file = configFile(
      'bad-response-schema.json',
      JSON.stringify([
        { method: 'GET', uri: '/a' },
        { method: 'GET', uri: '/b', responseSchema: { type: 'nope' } },
      ]),
    );
    try {
      readConfigEntries(file);
      expect.unreachable('should have thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(ConfigError);
      const message = (err as Error).message;
      expect(message).toContain(file);
      expect(message).toContain('entry 1');
      expect(message).toContain('responseSchema');
    }
  });

  it('throws for an entry combining body and responseSchema', () => {
    const file = configFile(
      'conflict.json',
      JSON.stringify([
        { method: 'GET', uri: '/x', body: { static: true }, responseSchema: { type: 'object' } },
      ]),
    );
    expect(() => readConfigEntries(file)).toThrowError(/cannot be combined/);
  });
});

describe('seedStoreFromFile', () => {
  it('registers entries into the given store in file order', () => {
    const file = configFile(
      'seed.json',
      JSON.stringify([
        { method: 'GET', uri: '/first', body: 'one' },
        { method: 'GET', uri: '/second', body: 'two' },
      ]),
    );
    const store = new MockStore(':memory:');
    const result = seedStoreFromFile(file, store);
    expect(result).toEqual({ path: file, seeded: 2, skipped: 0 });
    expect(store.list().map((r) => r.uri)).toEqual(['/first', '/second']);
    expect(store.list().map((r) => r.body)).toEqual(['one', 'two']);
  });

  it('seeds a wrapper-form file in file order, identically to the array form', () => {
    const file = configFile(
      'seed-wrapper.json',
      JSON.stringify({
        $schema: './mocks.schema.json',
        mocks: [
          { method: 'GET', uri: '/first', body: 'one' },
          { method: 'GET', uri: '/second', body: 'two' },
        ],
      }),
    );
    const store = new MockStore(':memory:');
    const result = seedStoreFromFile(file, store);
    expect(result).toEqual({ path: file, seeded: 2, skipped: 0 });
    expect(store.list().map((r) => r.uri)).toEqual(['/first', '/second']);
    expect(store.list().map((r) => r.body)).toEqual(['one', 'two']);
  });

  it('seeds nothing when the file is missing', () => {
    const store = new MockStore(':memory:');
    const result = seedStoreFromFile(path.join(dir, 'absent.json'), store);
    expect(result.seeded).toBe(0);
    expect(store.list()).toEqual([]);
  });

  it('skips seeding and leaves existing mocks untouched when the store is non-empty', () => {
    const file = configFile(
      'skip.json',
      JSON.stringify([
        { method: 'GET', uri: '/from-config', body: 'cfg' },
        { method: 'GET', uri: '/health', body: 'cfg-health' },
      ]),
    );
    const store = new MockStore(':memory:');
    const existing = store.add({ method: 'GET', uri: '/runtime', body: 'kept' });

    const result = seedStoreFromFile(file, store);

    expect(result).toEqual({ path: file, seeded: 0, skipped: 2 });
    expect(store.list().map((r) => r.id)).toEqual([existing.id]);
    expect(store.list().map((r) => r.body)).toEqual(['kept']);
  });

  it('still validates the config when the store is non-empty and throws on invalid entries', () => {
    const file = configFile('bad-nonempty.json', JSON.stringify([{ method: 'FETCH', uri: '/x' }]));
    const store = new MockStore(':memory:');
    store.add({ method: 'GET', uri: '/runtime' });
    expect(() => seedStoreFromFile(file, store)).toThrowError(ConfigError);
    expect(store.list().map((r) => r.uri)).toEqual(['/runtime']);
  });
});
