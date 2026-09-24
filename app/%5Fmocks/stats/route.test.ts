import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { getStats } from '../../../lib/stats.ts';
import type { CallStatsReport } from '../../../lib/stats.ts';
import { getStore } from '../../../lib/store.ts';
import { GET as mockHandler } from '../../[[...slug]]/route.ts';
import { GET as adminList } from '../route.ts';
import { DELETE, GET } from './route.ts';

async function report(): Promise<CallStatsReport> {
  const res = GET();
  expect(res.status).toBe(200);
  expect(res.headers.get('content-type')).toBe('application/json');
  return (await res.json()) as CallStatsReport;
}

/** Drives real mock traffic through the catch-all so reports reflect recording. */
function call(path: string, caller: string): void {
  mockHandler(new Request(`http://localhost${path}`, { headers: { 'user-agent': caller } }));
}

beforeEach(() => {
  getStore().clearAll();
  getStats().reset();
  delete process.env.MOCK_STATS_CALLER_HEADER;
});

afterEach(() => {
  delete process.env.MOCK_STATS_CALLER_HEADER;
});

describe('GET /_mocks/stats', () => {
  it('reports the caller header and empty entries for an empty journal', async () => {
    expect(await report()).toEqual({ callerHeader: 'user-agent', entries: [] });
  });

  it('reports the configured caller header name', async () => {
    process.env.MOCK_STATS_CALLER_HEADER = 'X-Client-Id';
    expect((await report()).callerHeader).toBe('X-Client-Id');
  });

  it('reports every entry field for recorded matched calls', async () => {
    getStore().add({ method: 'GET', uri: '/users/:id', body: 'u' });
    call('/users/1', 'suite-a');
    call('/users/2', 'suite-a');
    const { entries } = await report();
    expect(entries).toHaveLength(1);
    const [entry] = entries;
    expect(entry.method).toBe('GET');
    expect(entry.uri).toBe('/users/:id');
    expect(entry.matched).toBe(true);
    expect(entry.caller).toBe('suite-a');
    expect(entry.count).toBe(2);
    expect(Number.isNaN(Date.parse(entry.lastCalledAt))).toBe(false);
  });

  it('orders entries count-descending across matched and unmatched calls', async () => {
    getStore().add({ method: 'GET', uri: '/ping', body: 'pong' });
    call('/ping', 'suite-a');
    call('/ping', 'suite-a');
    call('/missing', 'suite-b');
    const { entries } = await report();
    expect(entries.map((e) => [e.uri, e.matched, e.caller, e.count])).toEqual([
      ['/ping', true, 'suite-a', 2],
      ['/missing', false, 'suite-b', 1],
    ]);
  });
});

describe('DELETE /_mocks/stats', () => {
  it('resets the journal and responds 204', async () => {
    getStore().add({ method: 'GET', uri: '/ping', body: 'pong' });
    call('/ping', 'suite-a');
    const res = DELETE();
    expect(res.status).toBe(204);
    expect((await report()).entries).toEqual([]);
  });

  it('leaves registered mocks untouched', async () => {
    const added = getStore().add({ method: 'GET', uri: '/ping', body: 'pong' });
    call('/ping', 'suite-a');
    DELETE();
    const list = (await (await adminList()).json()) as { id: string }[];
    expect(list.map((m) => m.id)).toEqual([added.id]);
  });

  it('responds 204 on an empty journal', () => {
    expect(DELETE().status).toBe(204);
  });

  it('resumes counting at 1 after reset', async () => {
    getStore().add({ method: 'GET', uri: '/ping', body: 'pong' });
    for (let i = 0; i < 5; i++) call('/ping', 'suite-a');
    expect((await report()).entries[0].count).toBe(5);
    DELETE();
    call('/ping', 'suite-a');
    expect((await report()).entries[0].count).toBe(1);
  });
});
