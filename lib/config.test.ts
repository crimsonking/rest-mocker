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

  it('throws when the top-level value is not an array', () => {
    const file = configFile('obj.json', JSON.stringify({ method: 'GET', uri: '/x' }));
    expect(() => readConfigEntries(file)).toThrowError(/expected a JSON array/);
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
