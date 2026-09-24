import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CallJournal, getStats, resolveCallerHeader } from './stats.ts';

function headers(caller: string): Headers {
  return new Headers({ 'user-agent': caller });
}

describe('CallJournal', () => {
  let journal: CallJournal;

  beforeEach(() => {
    journal = new CallJournal();
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-09-24T10:00:00.000Z'));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('aggregates repeated records for one key into a single entry', () => {
    journal.record({ method: 'GET', uri: '/users/:id', matched: true, headers: headers('suite-a') });
    journal.record({ method: 'GET', uri: '/users/:id', matched: true, headers: headers('suite-a') });
    journal.record({ method: 'GET', uri: '/users/:id', matched: true, headers: headers('suite-a') });
    expect(journal.entries()).toEqual([
      {
        method: 'GET',
        uri: '/users/:id',
        matched: true,
        caller: 'suite-a',
        count: 3,
        lastCalledAt: '2026-09-24T10:00:00.000Z',
      },
    ]);
  });

  it('refreshes lastCalledAt on later records', () => {
    journal.record({ method: 'GET', uri: '/ping', matched: true, headers: headers('suite-a') });
    vi.setSystemTime(new Date('2026-09-24T10:05:00.000Z'));
    journal.record({ method: 'GET', uri: '/ping', matched: true, headers: headers('suite-a') });
    const [entry] = journal.entries();
    expect(entry.count).toBe(2);
    expect(entry.lastCalledAt).toBe('2026-09-24T10:05:00.000Z');
  });

  it('normalizes the method to uppercase so methods aggregate regardless of case', () => {
    journal.record({ method: 'get', uri: '/ping', matched: true, headers: headers('suite-a') });
    journal.record({ method: 'GET', uri: '/ping', matched: true, headers: headers('suite-a') });
    const entries = journal.entries();
    expect(entries).toHaveLength(1);
    expect(entries[0].method).toBe('GET');
    expect(entries[0].count).toBe(2);
  });

  it('keeps matched and unmatched history for one method+uri separate', () => {
    journal.record({ method: 'GET', uri: '/health', matched: true, headers: headers('suite-a') });
    journal.record({ method: 'GET', uri: '/health', matched: false, headers: headers('suite-a') });
    const entries = journal.entries();
    expect(entries).toHaveLength(2);
    expect(entries.find((e) => e.matched)?.count).toBe(1);
    expect(entries.find((e) => !e.matched)?.count).toBe(1);
  });

  it('aggregates distinct method, uri, and caller combinations separately', () => {
    journal.record({ method: 'GET', uri: '/a', matched: true, headers: headers('suite-a') });
    journal.record({ method: 'POST', uri: '/a', matched: true, headers: headers('suite-a') });
    journal.record({ method: 'GET', uri: '/a', matched: true, headers: headers('suite-b') });
    expect(journal.entries()).toHaveLength(3);
  });

  it('reset empties the journal', () => {
    journal.record({ method: 'GET', uri: '/a', matched: true, headers: headers('suite-a') });
    journal.reset();
    expect(journal.entries()).toEqual([]);
  });

  it('returns copies so callers cannot mutate the journal through entries()', () => {
    journal.record({ method: 'GET', uri: '/a', matched: true, headers: headers('suite-a') });
    journal.entries()[0].count = 999;
    expect(journal.entries()[0].count).toBe(1);
  });
});

describe('getStats singleton', () => {
  beforeEach(() => {
    getStats().reset();
  });

  it('returns the same instance within a module registry', () => {
    expect(getStats()).toBe(getStats());
  });

  it('survives a simulated module re-import with its data', async () => {
    const journal = getStats();
    journal.record({ method: 'GET', uri: '/persistent', matched: true, headers: headers('suite-a') });

    vi.resetModules();
    // Dynamic import is the point of this test: it simulates an HMR module
    // reload, which a static import cannot exercise (mirrors the store test).
    const fresh = await import('./stats.ts');

    expect(fresh.getStats()).toBe(journal);
    expect(fresh.getStats().entries().map((e) => e.uri)).toEqual(['/persistent']);
  });
});

describe('caller resolution (MOCK_STATS_CALLER_HEADER)', () => {
  let journal: CallJournal;

  beforeEach(() => {
    journal = new CallJournal();
    delete process.env.MOCK_STATS_CALLER_HEADER;
  });

  afterEach(() => {
    delete process.env.MOCK_STATS_CALLER_HEADER;
  });

  it('resolves the default header name', () => {
    expect(resolveCallerHeader({})).toBe('user-agent');
  });

  it('honors a valid configured header name', () => {
    expect(resolveCallerHeader({ MOCK_STATS_CALLER_HEADER: 'X-Client-Id' })).toBe('X-Client-Id');
  });

  it('falls back to the default for empty or invalid header names', () => {
    expect(resolveCallerHeader({ MOCK_STATS_CALLER_HEADER: '' })).toBe('user-agent');
    expect(resolveCallerHeader({ MOCK_STATS_CALLER_HEADER: 'not a token!' })).toBe('user-agent');
  });

  it('reads the caller from the configured header, resolved lazily per record', () => {
    process.env.MOCK_STATS_CALLER_HEADER = 'X-Client-Id';
    journal.record({
      method: 'GET',
      uri: '/a',
      matched: true,
      headers: new Headers({ 'x-client-id': 'web', 'user-agent': 'ignored' }),
    });
    expect(journal.entries()[0].caller).toBe('web');
  });

  it('matches the configured header name case-insensitively', () => {
    process.env.MOCK_STATS_CALLER_HEADER = 'X-CLIENT-ID';
    journal.record({
      method: 'GET',
      uri: '/a',
      matched: true,
      headers: new Headers({ 'x-client-id': 'web' }),
    });
    expect(journal.entries()[0].caller).toBe('web');
  });

  it('records unknown when the caller header is absent', () => {
    journal.record({ method: 'GET', uri: '/a', matched: true, headers: new Headers() });
    expect(journal.entries()[0].caller).toBe('unknown');
  });

  it('records unknown for empty or whitespace-only header values', () => {
    journal.record({
      method: 'GET',
      uri: '/a',
      matched: true,
      headers: new Headers({ 'user-agent': '' }),
    });
    journal.record({
      method: 'GET',
      uri: '/b',
      matched: true,
      headers: new Headers({ 'user-agent': '   ' }),
    });
    expect(journal.entries().map((e) => e.caller)).toEqual(['unknown', 'unknown']);
  });

  it('uses the default header without throwing when the configured name is invalid', () => {
    process.env.MOCK_STATS_CALLER_HEADER = 'bad header name';
    journal.record({
      method: 'GET',
      uri: '/a',
      matched: true,
      headers: new Headers({ 'user-agent': 'suite-a' }),
    });
    expect(journal.entries()[0].caller).toBe('suite-a');
  });
});

describe('CallJournal.snapshot', () => {
  let journal: CallJournal;

  beforeEach(() => {
    journal = new CallJournal();
    delete process.env.MOCK_STATS_CALLER_HEADER;
  });

  afterEach(() => {
    delete process.env.MOCK_STATS_CALLER_HEADER;
  });

  it('reports the default caller header and an empty entries array for an empty journal', () => {
    expect(journal.snapshot()).toEqual({ callerHeader: 'user-agent', entries: [] });
  });

  it('reports the configured caller header name', () => {
    process.env.MOCK_STATS_CALLER_HEADER = 'X-Client-Id';
    expect(journal.snapshot().callerHeader).toBe('X-Client-Id');
  });

  it('sorts entries by count descending', () => {
    journal.record({ method: 'GET', uri: '/a', matched: true, headers: headers('suite-a') });
    journal.record({ method: 'GET', uri: '/b', matched: true, headers: headers('suite-a') });
    journal.record({ method: 'GET', uri: '/b', matched: true, headers: headers('suite-a') });
    expect(journal.snapshot().entries.map((e) => e.uri)).toEqual(['/b', '/a']);
  });

  it('breaks ties by method, then uri, then caller ascending', () => {
    journal.record({ method: 'POST', uri: '/z', matched: true, headers: headers('a') });
    journal.record({ method: 'GET', uri: '/z', matched: true, headers: headers('b') });
    journal.record({ method: 'GET', uri: '/a', matched: true, headers: headers('z') });
    journal.record({ method: 'GET', uri: '/z', matched: true, headers: headers('a') });
    expect(journal.snapshot().entries.map((e) => [e.method, e.uri, e.caller])).toEqual([
      ['GET', '/a', 'z'],
      ['GET', '/z', 'a'],
      ['GET', '/z', 'b'],
      ['POST', '/z', 'a'],
    ]);
  });

  it('does not disturb journal insertion order when sorting the report', () => {
    journal.record({ method: 'GET', uri: '/a', matched: true, headers: headers('suite-a') });
    journal.record({ method: 'GET', uri: '/b', matched: true, headers: headers('suite-a') });
    journal.record({ method: 'GET', uri: '/b', matched: true, headers: headers('suite-a') });
    journal.snapshot();
    expect(journal.entries().map((e) => e.uri)).toEqual(['/a', '/b']);
  });
});
