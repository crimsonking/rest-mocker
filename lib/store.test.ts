import { existsSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
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
