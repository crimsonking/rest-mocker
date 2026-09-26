import { beforeEach, describe, expect, it } from 'vitest';
import { getStore } from '../../lib/store.ts';
import { getStats } from '../../lib/stats.ts';
import type { MockDefinition } from '../../lib/validation.ts';
import type { HttpMethod } from '../../lib/types.ts';
import { DELETE, GET, HEAD, OPTIONS, PATCH, POST, PUT } from './route.ts';

const handlers: Record<string, (req: Request) => Promise<Response>> = {
  GET,
  POST,
  PUT,
  PATCH,
  DELETE,
  HEAD,
  OPTIONS,
};

async function send(
  method: string,
  path: string,
  headers?: Record<string, string>,
  body?: string,
): Promise<Response> {
  return handlers[method](new Request(`http://localhost${path}`, { method, headers, body }));
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
    const res = await send('GET', '/health');
    expect(res.status).toBe(200);
    expect(await res.text()).toBe('ok');
  });

  it('serves a :param match', async () => {
    add('/users/:id', 'GET', { body: { id: 'whatever' } });
    const res = await send('GET', '/users/42');
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ id: 'whatever' });
  });

  it('serves a wildcard match across multiple segments', async () => {
    add('/files/*', 'GET', { body: 'file-bytes' });
    expect(await (await send('GET', '/files/docs/a/b.png')).text()).toBe('file-bytes');
  });

  it('treats a method mismatch as unmatched', async () => {
    add('/health', 'GET', { body: 'ok' });
    const res = await send('POST', '/health');
    expect(res.status).toBe(500);
  });

  it('ignores the query string when matching', async () => {
    add('/health', 'GET', { body: 'ok' });
    const res = await send('GET', '/health?verbose=1&x=2');
    expect(res.status).toBe(200);
    expect(await res.text()).toBe('ok');
  });

  it('ignores a trailing slash when matching', async () => {
    add('/health', 'GET', { body: 'ok' });
    expect((await send('GET', '/health/')).status).toBe(200);
  });

  it('serves the full pre-defined response: status, headers, body', async () => {
    add('/created', 'POST', { status: 201, headers: { 'X-Trace': 'abc' }, body: { created: true } });
    const res = await send('POST', '/created');
    expect(res.status).toBe(201);
    expect(res.headers.get('X-Trace')).toBe('abc');
    expect(await res.json()).toEqual({ created: true });
  });

  it('defaults to status 200 when registration omitted it', async () => {
    add('/plain', 'GET', { body: 'text' });
    expect((await send('GET', '/plain')).status).toBe(200);
  });

  it('matches a mock registered for the root path', async () => {
    add('/', 'GET', { body: 'root' });
    expect(await (await send('GET', '/')).text()).toBe('root');
  });

  it('routes every exported method to its registered mock', async () => {
    for (const method of ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'] as HttpMethod[]) {
      add('/multi', method, { body: method });
    }
    for (const method of ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS']) {
      expect(await (await send(method, '/multi')).text()).toBe(method);
    }
  });
});

describe('catch-all — HEAD semantics (recorded assumption)', () => {
  it('serves a HEAD mock with status and headers but an empty body', async () => {
    add('/head', 'HEAD', { status: 204, headers: { 'X-H': '1' } });
    const res = await send('HEAD', '/head');
    expect(res.status).toBe(204);
    expect(res.headers.get('X-H')).toBe('1');
    expect(await res.text()).toBe('');
  });

  it('does not fall back from HEAD to a GET mock', async () => {
    add('/get-only', 'GET', { body: 'nope' });
    expect((await send('HEAD', '/get-only')).status).toBe(500);
  });
});

describe('catch-all — precedence (mock-routing spec scenarios)', () => {
  it('exact beats path parameter regardless of registration order', async () => {
    add('/users/me', 'GET', { body: 'me' });
    add('/users/:id', 'GET', { body: 'param' });
    expect(await (await send('GET', '/users/me')).text()).toBe('me');

    getStore().clearAll();
    add('/users/:id', 'GET', { body: 'param' });
    add('/users/me', 'GET', { body: 'me' });
    expect(await (await send('GET', '/users/me')).text()).toBe('me');
  });

  it('path parameter beats wildcard regardless of registration order', async () => {
    add('/users/:id', 'GET', { body: 'param' });
    add('/users/*', 'GET', { body: 'wild' });
    expect(await (await send('GET', '/users/42')).text()).toBe('param');

    getStore().clearAll();
    add('/users/*', 'GET', { body: 'wild' });
    add('/users/:id', 'GET', { body: 'param' });
    expect(await (await send('GET', '/users/42')).text()).toBe('param');
  });

  it('latest registration wins on identical patterns', async () => {
    add('/orders', 'GET', { body: 'first' });
    add('/orders', 'GET', { body: 'second' });
    expect(await (await send('GET', '/orders')).text()).toBe('second');
  });
});

describe('catch-all — unmatched and reserved prefix', () => {
  it('answers unmatched requests with a JSON 500 naming method and path', async () => {
    const res = await send('GET', '/unknown');
    expect(res.status).toBe(500);
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

    const res = await send('GET', '/_mocks');
    expect(res.status).toBe(500);
    const payload = (await res.json()) as { error: { path: string } };
    expect(payload.error.path).toBe('/_mocks');

    expect((await send('GET', '/_mocks/a/b')).status).toBe(500);
  });
});

describe('catch-all — call recording (mock-stats spec scenarios)', () => {
  const recorded = () => getStats().snapshot().entries;
  const as = (caller: string) => ({ 'user-agent': caller });

  it('aggregates matched calls under the registered mock pattern', async () => {
    add('/users/:id', 'GET', { body: 'u' });
    await send('GET', '/users/1', as('suite-a'));
    await send('GET', '/users/2', as('suite-a'));
    await send('GET', '/users/1', as('suite-a'));
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

  it('records unmatched calls under the normalized request path', async () => {
    await send('GET', '/nope', as('suite-a'));
    await send('GET', '/nope/', as('suite-a'));
    await send('GET', '/nope?x=1', as('suite-a'));
    expect(recorded()).toEqual([
      expect.objectContaining({ uri: '/nope', matched: false, caller: 'suite-a', count: 3 }),
    ]);
  });

  it('separates callers on the same endpoint', async () => {
    add('/ping', 'GET', { body: 'pong' });
    await send('GET', '/ping', as('suite-a'));
    await send('GET', '/ping', as('suite-b'));
    expect(recorded().map((e) => e.caller)).toEqual(['suite-a', 'suite-b']);
  });

  it('never records reserved-prefix requests', async () => {
    await send('GET', '/_mocks', as('suite-a'));
    await send('GET', '/_mocks/deep/sub', as('suite-a'));
    expect(recorded()).toEqual([]);
    add('/ping', 'GET', { body: 'pong' });
    await send('GET', '/ping', as('suite-a'));
    expect(recorded()).toHaveLength(1);
  });

  it('keeps matched and unmatched history separate when a mock is deleted between calls', async () => {
    const mock = add('/health', 'GET', { body: 'ok' });
    await send('GET', '/health', as('suite-a'));
    getStore().deleteById(mock.id);
    await send('GET', '/health', as('suite-a'));
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

describe('catch-all — bodySchema enforcement (mock-routing spec scenarios)', () => {
  const orderSchema = {
    type: 'object',
    required: ['name'],
    properties: { name: { type: 'string' }, age: { type: 'integer' } },
  };

  it('serves the registered response when the body conforms', async () => {
    add('/orders', 'POST', {
      status: 201,
      headers: { 'X-Trace': 'abc' },
      body: { ok: true },
      bodySchema: orderSchema,
    });

    const res = await send('POST', '/orders', undefined, JSON.stringify({ name: 'widget' }));
    expect(res.status).toBe(201);
    expect(res.headers.get('X-Trace')).toBe('abc');
    expect(await res.json()).toEqual({ ok: true });
  });

  it('rejects a non-conforming body with 400 and details naming the instance path', async () => {
    add('/orders', 'POST', { body: { ok: true }, bodySchema: orderSchema });

    const res = await send('POST', '/orders', undefined, JSON.stringify({ name: 42 }));
    expect(res.status).toBe(400);
    expect(res.headers.get('content-type')).toBe('application/json');
    const payload = (await res.json()) as {
      error: { method: string; path: string; details: { field: string; message: string }[] };
    };
    expect(payload.error.method).toBe('POST');
    expect(payload.error.path).toBe('/orders');
    expect(payload.error.details).toContainEqual({ field: '/name', message: 'must be string' });
  });

  it('rejects an absent or empty body with a root-level 400 detail', async () => {
    add('/orders', 'POST', { body: { ok: true }, bodySchema: orderSchema });

    const absent = await send('POST', '/orders');
    expect(absent.status).toBe(400);
    const absentPayload = (await absent.json()) as { error: { details: { field: string }[] } };
    expect(absentPayload.error.details[0].field).toBe('');

    const empty = await send('POST', '/orders', undefined, '');
    expect(empty.status).toBe(400);
  });

  it('rejects a non-JSON body with 400', async () => {
    add('/orders', 'POST', { body: { ok: true }, bodySchema: orderSchema });

    const res = await send('POST', '/orders', undefined, 'plain text, not json');
    expect(res.status).toBe(400);
    const payload = (await res.json()) as { error: { details: { field: string; message: string }[] } };
    expect(payload.error.details[0].message).toMatch(/valid JSON/);
  });

  it('does not fall through to a lower-precedence wildcard mock', async () => {
    add('/orders/:id', 'POST', { body: { exact: true }, bodySchema: orderSchema });
    add('/orders/*', 'POST', { body: { wildcard: true } });

    const res = await send('POST', '/orders/1', undefined, JSON.stringify({ name: 42 }));
    expect(res.status).toBe(400);
    expect(await res.json()).not.toEqual({ wildcard: true });
  });

  it('journals a rejected call as matched under the registered pattern', async () => {
    add('/orders/:id', 'POST', { body: { ok: true }, bodySchema: orderSchema });

    const res = await send('POST', '/orders/7', undefined, JSON.stringify({ name: 42 }));
    expect(res.status).toBe(400);

    expect(getStats().snapshot().entries).toEqual([
      expect.objectContaining({ method: 'POST', uri: '/orders/:id', matched: true, count: 1 }),
    ]);
  });

  it('serves a schema-less mock unchanged even with a malformed body', async () => {
    add('/plain', 'POST', { status: 202, body: 'canned' });

    const res = await send('POST', '/plain', undefined, '{not json at all');
    expect(res.status).toBe(202);
    expect(await res.text()).toBe('canned');
  });

  it('rejects a bodyless HEAD request against a bodySchema mock', async () => {
    add('/head-schema', 'HEAD', { status: 200, bodySchema: { type: 'object' } });

    const res = await send('HEAD', '/head-schema');
    expect(res.status).toBe(400);
  });
});

describe('catch-all — responseSchema generation (mock-routing spec scenarios)', () => {
  const userSchema = {
    type: 'object',
    required: ['id', 'name'],
    properties: {
      id: { type: 'integer' },
      name: { type: 'string' },
      email: { type: 'string', format: 'email' },
    },
  };

  function expectConforming(value: unknown) {
    expect(value).toBeTypeOf('object');
    const user = value as { id: number; name: string };
    expect(Number.isInteger(user.id)).toBe(true);
    expect(typeof user.name).toBe('string');
  }

  it('serves a generated body conforming to the schema as application/json', async () => {
    add('/users/:id', 'GET', { responseSchema: userSchema });

    const res = await send('GET', '/users/42');
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('application/json');
    expectConforming(await res.json());
  });

  it('generates a conforming body independently on every call', async () => {
    add('/users/:id', 'GET', { responseSchema: userSchema });

    const first = await (await send('GET', '/users/1')).json();
    const second = await (await send('GET', '/users/2')).json();
    expectConforming(first);
    expectConforming(second);
  });

  it('applies the registered status and headers to the generated response', async () => {
    add('/created', 'POST', { status: 201, headers: { 'X-Trace': 'abc' }, responseSchema: userSchema });

    const res = await send('POST', '/created');
    expect(res.status).toBe(201);
    expect(res.headers.get('X-Trace')).toBe('abc');
    expectConforming(await res.json());
  });

  it('serves HEAD with status and headers and no generated body', async () => {
    add('/head-gen', 'HEAD', { status: 200, headers: { 'X-H': '1' }, responseSchema: userSchema });

    const res = await send('HEAD', '/head-gen');
    expect(res.status).toBe(200);
    expect(res.headers.get('X-H')).toBe('1');
    expect(await res.text()).toBe('');
  });

  it('omits the generated body for null-body statuses like 204', async () => {
    add('/no-content', 'POST', { status: 204, responseSchema: userSchema });

    const res = await send('POST', '/no-content');
    expect(res.status).toBe(204);
    expect(await res.text()).toBe('');
  });

  it('serves a static-body mock without a schema unchanged', async () => {
    add('/static', 'GET', { status: 202, body: { canned: true } });

    const res = await send('GET', '/static');
    expect(res.status).toBe(202);
    expect(await res.json()).toEqual({ canned: true });
  });

  it('combines bodySchema validation with responseSchema generation', async () => {
    add('/orders', 'POST', {
      bodySchema: { type: 'object', required: ['name'], properties: { name: { type: 'string' } } },
      responseSchema: { type: 'object', required: ['ok'], properties: { ok: { type: 'boolean' } } },
    });

    const rejected = await send('POST', '/orders', undefined, JSON.stringify({ name: 42 }));
    expect(rejected.status).toBe(400);

    const accepted = await send('POST', '/orders', undefined, JSON.stringify({ name: 'widget' }));
    expect(accepted.status).toBe(200);
    const generated = (await accepted.json()) as { ok: boolean };
    expect(typeof generated.ok).toBe('boolean');
  });
});
