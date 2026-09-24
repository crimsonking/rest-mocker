import { beforeEach, describe, expect, it } from 'vitest';
import { getStore } from '../../lib/store.ts';
import { getStats } from '../../lib/stats.ts';
import type { MockDefinition } from '../../lib/validation.ts';
import type { HttpMethod } from '../../lib/types.ts';
import { DELETE, GET, HEAD, OPTIONS, PATCH, POST, PUT } from './route.ts';

const handlers: Record<string, (req: Request) => Response> = {
  GET,
  POST,
  PUT,
  PATCH,
  DELETE,
  HEAD,
  OPTIONS,
};

function send(method: string, path: string, headers?: Record<string, string>): Response {
  return handlers[method](new Request(`http://localhost${path}`, { method, headers }));
}

function add(uri: string, method: HttpMethod = 'GET', extra: Partial<MockDefinition> = {}) {
  return getStore().add({ method, uri, ...extra });
}

beforeEach(() => {
  getStore().clearAll();
  getStats().reset();
});

describe('catch-all — matching (mock-routing spec scenarios)', () => {
  it('serves an exact path match', async () => {
    add('/health', 'GET', { body: 'ok' });
    const res = send('GET', '/health');
    expect(res.status).toBe(200);
    expect(await res.text()).toBe('ok');
  });

  it('serves a :param match', async () => {
    add('/users/:id', 'GET', { body: { id: 'whatever' } });
    const res = send('GET', '/users/42');
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ id: 'whatever' });
  });

  it('serves a wildcard match across multiple segments', async () => {
    add('/files/*', 'GET', { body: 'file-bytes' });
    expect(await send('GET', '/files/docs/a/b.png').text()).toBe('file-bytes');
  });

  it('treats a method mismatch as unmatched', async () => {
    add('/health', 'GET', { body: 'ok' });
    const res = send('POST', '/health');
    expect(res.status).toBe(404);
  });

  it('ignores the query string when matching', async () => {
    add('/health', 'GET', { body: 'ok' });
    const res = send('GET', '/health?verbose=1&x=2');
    expect(res.status).toBe(200);
    expect(await res.text()).toBe('ok');
  });

  it('ignores a trailing slash when matching', async () => {
    add('/health', 'GET', { body: 'ok' });
    expect(send('GET', '/health/').status).toBe(200);
  });

  it('serves the full pre-defined response: status, headers, body', async () => {
    add('/created', 'POST', { status: 201, headers: { 'X-Trace': 'abc' }, body: { created: true } });
    const res = send('POST', '/created');
    expect(res.status).toBe(201);
    expect(res.headers.get('X-Trace')).toBe('abc');
    expect(await res.json()).toEqual({ created: true });
  });

  it('defaults to status 200 when registration omitted it', async () => {
    add('/plain', 'GET', { body: 'text' });
    expect(send('GET', '/plain').status).toBe(200);
  });

  it('matches a mock registered for the root path', async () => {
    add('/', 'GET', { body: 'root' });
    expect(await send('GET', '/').text()).toBe('root');
  });

  it('routes every exported method to its registered mock', async () => {
    for (const method of ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'] as HttpMethod[]) {
      add('/multi', method, { body: method });
    }
    for (const method of ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS']) {
      expect(await send(method, '/multi').text()).toBe(method);
    }
  });
});

describe('catch-all — HEAD semantics (recorded assumption)', () => {
  it('serves a HEAD mock with status and headers but an empty body', async () => {
    add('/head', 'HEAD', { status: 204, headers: { 'X-H': '1' } });
    const res = send('HEAD', '/head');
    expect(res.status).toBe(204);
    expect(res.headers.get('X-H')).toBe('1');
    expect(await res.text()).toBe('');
  });

  it('does not fall back from HEAD to a GET mock', () => {
    add('/get-only', 'GET', { body: 'nope' });
    expect(send('HEAD', '/get-only').status).toBe(404);
  });
});

describe('catch-all — precedence (mock-routing spec scenarios)', () => {
  it('exact beats path parameter regardless of registration order', async () => {
    add('/users/me', 'GET', { body: 'me' });
    add('/users/:id', 'GET', { body: 'param' });
    expect(await send('GET', '/users/me').text()).toBe('me');

    getStore().clearAll();
    add('/users/:id', 'GET', { body: 'param' });
    add('/users/me', 'GET', { body: 'me' });
    expect(await send('GET', '/users/me').text()).toBe('me');
  });

  it('path parameter beats wildcard regardless of registration order', async () => {
    add('/users/:id', 'GET', { body: 'param' });
    add('/users/*', 'GET', { body: 'wild' });
    expect(await send('GET', '/users/42').text()).toBe('param');

    getStore().clearAll();
    add('/users/*', 'GET', { body: 'wild' });
    add('/users/:id', 'GET', { body: 'param' });
    expect(await send('GET', '/users/42').text()).toBe('param');
  });

  it('latest registration wins on identical patterns', async () => {
    add('/orders', 'GET', { body: 'first' });
    add('/orders', 'GET', { body: 'second' });
    expect(await send('GET', '/orders').text()).toBe('second');
  });
});

describe('catch-all — unmatched and reserved prefix', () => {
  it('answers unmatched requests with a JSON 404 naming method and path', async () => {
    const res = send('GET', '/unknown');
    expect(res.status).toBe(404);
    expect(res.headers.get('content-type')).toBe('application/json');
    const payload = (await res.json()) as { error: { method: string; path: string } };
    expect(payload.error.method).toBe('GET');
    expect(payload.error.path).toBe('/unknown');
  });

  it('never matches stored mocks on the reserved /_mocks prefix', async () => {
    // Force reserved-path mocks directly into the store (registration
    // validation rejects these; the handler guard is defense in depth).
    add('/_mocks', 'GET', { body: 'should never be served' });
    add('/_mocks/*', 'GET', { body: 'should never be served' });

    const res = send('GET', '/_mocks');
    expect(res.status).toBe(404);
    const payload = (await res.json()) as { error: { path: string } };
    expect(payload.error.path).toBe('/_mocks');

    expect(send('GET', '/_mocks/a/b').status).toBe(404);
  });
});

describe('catch-all — call recording (mock-stats spec scenarios)', () => {
  const recorded = () => getStats().snapshot().entries;
  const as = (caller: string) => ({ 'user-agent': caller });

  it('aggregates matched calls under the registered mock pattern', () => {
    add('/users/:id', 'GET', { body: 'u' });
    send('GET', '/users/1', as('suite-a'));
    send('GET', '/users/2', as('suite-a'));
    send('GET', '/users/1', as('suite-a'));
    expect(recorded()).toEqual([
      expect.objectContaining({
        method: 'GET',
        uri: '/users/:id',
        matched: true,
        caller: 'suite-a',
        count: 3,
      }),
    ]);
  });

  it('records unmatched calls under the normalized request path', () => {
    send('GET', '/nope', as('suite-a'));
    send('GET', '/nope/', as('suite-a'));
    send('GET', '/nope?x=1', as('suite-a'));
    expect(recorded()).toEqual([
      expect.objectContaining({ uri: '/nope', matched: false, caller: 'suite-a', count: 3 }),
    ]);
  });

  it('separates callers on the same endpoint', () => {
    add('/ping', 'GET', { body: 'pong' });
    send('GET', '/ping', as('suite-a'));
    send('GET', '/ping', as('suite-b'));
    expect(recorded().map((e) => e.caller)).toEqual(['suite-a', 'suite-b']);
  });

  it('never records reserved-prefix requests', () => {
    send('GET', '/_mocks', as('suite-a'));
    send('GET', '/_mocks/deep/sub', as('suite-a'));
    expect(recorded()).toEqual([]);
    add('/ping', 'GET', { body: 'pong' });
    send('GET', '/ping', as('suite-a'));
    expect(recorded()).toHaveLength(1);
  });

  it('keeps matched and unmatched history separate when a mock is deleted between calls', () => {
    const mock = add('/health', 'GET', { body: 'ok' });
    send('GET', '/health', as('suite-a'));
    getStore().deleteById(mock.id);
    send('GET', '/health', as('suite-a'));
    const entries = recorded();
    expect(entries).toHaveLength(2);
    expect(entries.find((e) => e.matched)).toEqual(
      expect.objectContaining({ uri: '/health', count: 1 }),
    );
    expect(entries.find((e) => !e.matched)).toEqual(
      expect.objectContaining({ uri: '/health', count: 1 }),
    );
  });
});
