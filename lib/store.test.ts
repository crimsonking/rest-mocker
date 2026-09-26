import { existsSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getStore, MockStore, resolveDbPath } from './store.ts';
import { findMatchingMock } from './matcher.ts';
import type { Json } from './types.ts';

function tempDbFile(): string {
  return path.join(mkdtempSync(path.join(tmpdir(), 'mock-store-')), 'mocks.db');
}

describe('resolveDbPath', () => {
  it('defaults to mocks.db under cwd', () => {
    expect(resolveDbPath({}, '/srv/app')).toBe('/srv/app/mocks.db');
  });

  it('honors MOCK_DB_FILE, resolving relative paths against cwd', () => {
    expect(resolveDbPath({ MOCK_DB_FILE: 'data/m.db' }, '/srv/app')).toBe('/srv/app/data/m.db');
    expect(resolveDbPath({ MOCK_DB_FILE: '/abs/m.db' }, '/srv/app')).toBe('/abs/m.db');
  });
});

describe('MockStore construction', () => {
  it('creates the database file and reopens it idempotently', () => {
    const file = tempDbFile();
    const first = new MockStore(file);
    first.add({ method: 'GET', uri: '/x' });
    first.close();

    expect(existsSync(file)).toBe(true);

    const second = new MockStore(file);
    expect(second.list().map((r) => r.uri)).toEqual(['/x']);
    second.close();
  });

  it('throws an error naming the path when the database cannot be opened', () => {
    const bad = path.join(mkdtempSync(path.join(tmpdir(), 'mock-store-')), 'missing-dir', 'x.db');
    try {
      new MockStore(bad);
      expect.unreachable('should have thrown');
    } catch (err) {
      expect((err as Error).message).toContain('Cannot open mock database');
      expect((err as Error).message).toContain(bad);
    }
  });
});

describe('MockStore', () => {
  let store: MockStore;

  beforeEach(() => {
    store = new MockStore(':memory:');
  });

  it('assigns a uuid id, monotonic seq, and normalizes defaults on add', () => {
    const first = store.add({ method: 'GET', uri: '/a' });
    const second = store.add({ method: 'POST', uri: '/b', status: 201, headers: { 'X-H': 'v' }, body: 'hi' });

    expect(first.id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
    expect(first.status).toBe(200);
    expect(first.headers).toEqual({});
    expect(first.body).toBeUndefined();
    expect(second.status).toBe(201);
    expect(second.seq).toBeGreaterThan(first.seq);
  });

  it('lists mocks in registration order', () => {
    store.add({ method: 'GET', uri: '/first' });
    store.add({ method: 'GET', uri: '/second' });
    store.add({ method: 'GET', uri: '/third' });
    expect(store.list().map((r) => r.uri)).toEqual(['/first', '/second', '/third']);
  });

  it('deletes by id and reports whether anything was removed', () => {
    const route = store.add({ method: 'GET', uri: '/gone' });
    expect(store.deleteById(route.id)).toBe(true);
    expect(store.list()).toEqual([]);
    expect(store.deleteById(route.id)).toBe(false);
    expect(store.deleteById('unknown-id')).toBe(false);
  });

  it('clears all mocks and keeps sequencing monotonic afterwards', () => {
    const before = store.add({ method: 'GET', uri: '/a' });
    store.clearAll();
    expect(store.list()).toEqual([]);
    const after = store.add({ method: 'GET', uri: '/b' });
    expect(after.seq).toBeGreaterThan(before.seq);
  });

  it('copies headers so later mutation of the definition cannot leak', () => {
    const headers = { 'X-A': '1' };
    const route = store.add({ method: 'GET', uri: '/x', headers });
    headers['X-A'] = 'mutated';
    expect(route.headers['X-A']).toBe('1');
  });

  it('round-trips every Json body variant, distinguishing absent from null', () => {
    const bodies: Json[] = [
      'text',
      42.5,
      false,
      null,
      [1, 'two', null, { three: [4] }],
      { a: { b: 'c' }, d: [1, 2] },
    ];
    for (const body of bodies) {
      const route = store.add({ method: 'GET', uri: '/rt', body });
      const stored = store.list().find((r) => r.id === route.id);
      expect(stored).toEqual(route);
      expect(stored?.body).toEqual(body);
    }

    const absent = store.add({ method: 'GET', uri: '/no-body' });
    const storedAbsent = store.list().find((r) => r.id === absent.id);
    expect(storedAbsent).toEqual(absent);
    expect(storedAbsent && 'body' in storedAbsent).toBe(false);
  });

  it('isEmpty reflects stored rows', () => {
    expect(store.isEmpty()).toBe(true);
    const route = store.add({ method: 'GET', uri: '/x' });
    expect(store.isEmpty()).toBe(false);
    store.deleteById(route.id);
    expect(store.isEmpty()).toBe(true);
  });

  it('round-trips bodySchema and leaves it absent when not declared', () => {
    const bodySchema = { type: 'object', required: ['name'], properties: { name: { type: 'string' } } };
    const withSchema = store.add({ method: 'POST', uri: '/orders', bodySchema });
    const without = store.add({ method: 'GET', uri: '/plain' });

    const storedWith = store.list().find((r) => r.id === withSchema.id);
    const storedWithout = store.list().find((r) => r.id === without.id);
    expect(storedWith).toEqual(withSchema);
    expect(storedWith?.bodySchema).toEqual(bodySchema);
    expect(storedWithout && 'bodySchema' in storedWithout).toBe(false);
  });

  it('round-trips responseSchema and leaves it absent when not declared', () => {
    const responseSchema = { type: 'object', required: ['id'], properties: { id: { type: 'integer' } } };
    const withSchema = store.add({ method: 'GET', uri: '/users/:id', responseSchema });
    const without = store.add({ method: 'GET', uri: '/plain' });

    const storedWith = store.list().find((r) => r.id === withSchema.id);
    const storedWithout = store.list().find((r) => r.id === without.id);
    expect(storedWith).toEqual(withSchema);
    expect(storedWith?.responseSchema).toEqual(responseSchema);
    expect(storedWithout && 'responseSchema' in storedWithout).toBe(false);
  });
});

// A restart is modeled as close() + reopening the same database file (design
// D11): same durable state, fresh connection and counter — exactly what a
// new server process sees.
describe('MockStore restart persistence', () => {
  it('keeps a runtime registration with its original id and fields', () => {
    const file = tempDbFile();
    const first = new MockStore(file);
    const added = first.add({
      method: 'GET',
      uri: '/ping',
      status: 201,
      headers: { 'X-Trace': 'abc' },
      body: { ok: true },
    });
    first.close();

    const second = new MockStore(file);
    expect(second.list()).toEqual([added]);
    expect(second.list()[0].id).toBe(added.id);
    second.close();
  });

  it('keeps listing order oldest registration first', () => {
    const file = tempDbFile();
    const first = new MockStore(file);
    first.add({ method: 'GET', uri: '/first' });
    first.add({ method: 'GET', uri: '/second' });
    first.add({ method: 'GET', uri: '/third' });
    first.close();

    const second = new MockStore(file);
    expect(second.list().map((r) => r.uri)).toEqual(['/first', '/second', '/third']);
    second.close();
  });

  it('keeps the latest-registration tie-break and continues sequencing after restart', () => {
    const file = tempDbFile();
    const first = new MockStore(file);
    first.add({ method: 'GET', uri: '/orders', body: 'old' });
    const winner = first.add({ method: 'GET', uri: '/orders', body: 'new' });
    first.close();

    const second = new MockStore(file);
    const matched = findMatchingMock(second.list(), 'GET', '/orders');
    expect(matched?.id).toBe(winner.id);
    expect(matched?.body).toBe('new');

    // A registration added after the restart outranks the persisted ones
    // (seq counter continues from the persisted maximum, design D10).
    const newest = second.add({ method: 'GET', uri: '/orders', body: 'newest' });
    expect(newest.seq).toBeGreaterThan(winner.seq);
    expect(findMatchingMock(second.list(), 'GET', '/orders')?.id).toBe(newest.id);
    second.close();
  });

  it('keeps a delete-by-id removal', () => {
    const file = tempDbFile();
    const first = new MockStore(file);
    const gone = first.add({ method: 'GET', uri: '/gone' });
    const kept = first.add({ method: 'GET', uri: '/kept' });
    first.deleteById(gone.id);
    first.close();

    const second = new MockStore(file);
    expect(second.list().map((r) => r.id)).toEqual([kept.id]);
    expect(second.deleteById(gone.id)).toBe(false);
    second.close();
  });

  it('keeps clear-all so the store reopens empty', () => {
    const file = tempDbFile();
    const first = new MockStore(file);
    first.add({ method: 'GET', uri: '/a' });
    first.clearAll();
    first.close();

    const second = new MockStore(file);
    expect(second.list()).toEqual([]);
    expect(second.isEmpty()).toBe(true);
    second.close();
  });

  it('keeps bodySchema intact across a restart', () => {
    const file = tempDbFile();
    const first = new MockStore(file);
    const added = first.add({
      method: 'POST',
      uri: '/orders',
      bodySchema: { type: 'object', required: ['name'], properties: { name: { type: 'string' } } },
    });
    first.close();

    const second = new MockStore(file);
    expect(second.list()).toEqual([added]);
    expect(second.list()[0].bodySchema).toEqual(added.bodySchema);
    second.close();
  });

  it('keeps responseSchema intact across a restart', () => {
    const file = tempDbFile();
    const first = new MockStore(file);
    const added = first.add({
      method: 'GET',
      uri: '/users/:id',
      responseSchema: { type: 'object', required: ['id'], properties: { id: { type: 'integer' } } },
    });
    first.close();

    const second = new MockStore(file);
    expect(second.list()).toEqual([added]);
    expect(second.list()[0].responseSchema).toEqual(added.responseSchema);
    second.close();
  });

  it('migrates a pre-body_schema database in place and lists old rows without the field', () => {
    const file = tempDbFile();
    // Recreate the table exactly as the pre-migration schema defined it,
    // then let MockStore.open add the missing column on first contact.
    const legacy = new DatabaseSync(file);
    legacy.exec(`CREATE TABLE mocks (
      id TEXT PRIMARY KEY,
      method TEXT NOT NULL,
      uri TEXT NOT NULL,
      status INTEGER NOT NULL,
      headers TEXT NOT NULL,
      body TEXT NULL,
      seq INTEGER NOT NULL UNIQUE
    )`);
    legacy
      .prepare('INSERT INTO mocks (id, method, uri, status, headers, body, seq) VALUES (?, ?, ?, ?, ?, ?, ?)')
      .run('legacy-id', 'GET', '/old', 200, '{}', null, 1);
    legacy.close();

    const store = new MockStore(file);
    const rows = store.list();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ id: 'legacy-id', method: 'GET', uri: '/old' });
    expect(rows[0] && 'bodySchema' in rows[0]).toBe(false);

    // The migrated table accepts new rows with a schema.
    const added = store.add({ method: 'POST', uri: '/new', bodySchema: { type: 'object' } });
    expect(store.list().find((r) => r.id === added.id)?.bodySchema).toEqual({ type: 'object' });
    store.close();
  });

  it('migrates a body_schema-era database missing only response_schema', () => {
    const file = tempDbFile();
    // Intermediate shape: created after body_schema existed but before
    // response_schema did — the migration must add only the missing column.
    const legacy = new DatabaseSync(file);
    legacy.exec(`CREATE TABLE mocks (
      id TEXT PRIMARY KEY,
      method TEXT NOT NULL,
      uri TEXT NOT NULL,
      status INTEGER NOT NULL,
      headers TEXT NOT NULL,
      body TEXT NULL,
      body_schema TEXT NULL,
      seq INTEGER NOT NULL UNIQUE
    )`);
    legacy
      .prepare(
        'INSERT INTO mocks (id, method, uri, status, headers, body, body_schema, seq) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
      )
      .run('mid-era-id', 'POST', '/orders', 200, '{}', null, '{"type":"object"}', 1);
    legacy.close();

    const store = new MockStore(file);
    const rows = store.list();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ id: 'mid-era-id', bodySchema: { type: 'object' } });
    expect(rows[0] && 'responseSchema' in rows[0]).toBe(false);

    const added = store.add({ method: 'GET', uri: '/gen', responseSchema: { type: 'integer' } });
    expect(store.list().find((r) => r.id === added.id)?.responseSchema).toEqual({ type: 'integer' });
    store.close();
  });
});

describe('getStore singleton', () => {
  // Isolate the singleton's database: resolveDbPath reads MOCK_DB_FILE at
  // call time, so pointing it at a fresh temp file before the first
  // getStore() keeps the repo-root mocks.db untouched (design D11/D14).
  beforeEach(() => {
    process.env.MOCK_DB_FILE = tempDbFile();
  });

  it('returns the same instance within a module registry', () => {
    expect(getStore()).toBe(getStore());
  });

  it('survives a simulated module re-import with its data', async () => {
    const store = getStore();
    store.clearAll();
    const added = store.add({ method: 'GET', uri: '/persistent' });

    vi.resetModules();
    // Dynamic import is the point of this test: it simulates an HMR module
    // reload, which a static import cannot exercise.
    const fresh = await import('./store.ts');

    expect(fresh.getStore()).toBe(store);
    expect(fresh.getStore().list().map((r) => r.id)).toEqual([added.id]);
    fresh.getStore().clearAll();
  });
});
