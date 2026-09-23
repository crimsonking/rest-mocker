import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getStore, MockStore } from './store.ts';

describe('MockStore', () => {
  let store: MockStore;

  beforeEach(() => {
    store = new MockStore();
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
});

describe('getStore singleton', () => {
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
