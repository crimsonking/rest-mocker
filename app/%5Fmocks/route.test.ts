import { beforeEach, describe, expect, it } from 'vitest';
import { getStore } from '../../lib/store.ts';
import { DELETE, GET, POST } from './route.ts';

function postRequest(payload: unknown): Request {
  return new Request('http://localhost/_mocks', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(payload),
  });
}

function postRaw(body: string): Request {
  return new Request('http://localhost/_mocks', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body,
  });
}

beforeEach(() => {
  getStore().clearAll();
});

describe('POST /_mocks', () => {
  it('registers a valid mock and responds 201 with the stored mock and id', async () => {
    const res = await POST(
      postRequest({ method: 'GET', uri: '/ping', status: 200, body: 'pong' }),
    );
    expect(res.status).toBe(201);
    const created = (await res.json()) as Record<string, unknown>;
    expect(created.id).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
    );
    expect(created).toMatchObject({ method: 'GET', uri: '/ping', status: 200, body: 'pong' });
    expect(getStore().list().map((r) => r.id)).toEqual([created.id]);
  });

  it('normalizes method case and defaults status to 200', async () => {
    const res = await POST(postRequest({ method: 'post', uri: '/submit' }));
    expect(res.status).toBe(201);
    const created = (await res.json()) as Record<string, unknown>;
    expect(created.method).toBe('POST');
    expect(created.status).toBe(200);
    expect(created.headers).toEqual({});
  });

  it('accepts re-registering the same method+uri and keeps both, newest last', async () => {
    await POST(postRequest({ method: 'GET', uri: '/orders', body: 'first' }));
    const second = await POST(postRequest({ method: 'GET', uri: '/orders', body: 'second' }));
    expect(second.status).toBe(201);
    const list = getStore().list();
    expect(list.map((r) => r.body)).toEqual(['first', 'second']);
    expect(list[1].seq).toBeGreaterThan(list[0].seq);
  });

  it('rejects a malformed JSON body with 400', async () => {
    const res = await POST(postRaw('{not json'));
    expect(res.status).toBe(400);
    const payload = (await res.json()) as { error: { message: string } };
    expect(payload.error.message).toMatch(/valid JSON/);
    expect(getStore().list()).toEqual([]);
  });

  it('rejects invalid definitions with field errors and registers nothing', async () => {
    const invalidPayloads: unknown[] = [
      'not-an-object',
      [{ method: 'GET', uri: '/x' }],
      { uri: '/ping' },
      { method: 'FETCH', uri: '/ping' },
      { method: 'GET' },
      { method: 'GET', uri: 'ping' },
      { method: 'GET', uri: '/_mocks/anything' },
      { method: 'GET', uri: '/ping', status: '200' },
      { method: 'GET', uri: '/ping', headers: { 'X-A': 3 } },
    ];
    for (const payload of invalidPayloads) {
      const res = await POST(postRequest(payload));
      expect(res.status, JSON.stringify(payload)).toBe(400);
      const body = (await res.json()) as { error: { message: string; details?: { field: string }[] } };
      expect(body.error.message, JSON.stringify(payload)).toMatch(/invalid|JSON object/);
      if (body.error.details) expect(body.error.details.length).toBeGreaterThan(0);
    }
    expect(getStore().list()).toEqual([]);
  });

  it('names the offending field for a missing method', async () => {
    const res = await POST(postRequest({ uri: '/ping' }));
    const body = (await res.json()) as { error: { details: { field: string; message: string }[] } };
    expect(body.error.details).toContainEqual({ field: 'method', message: 'method is required' });
  });

  it('registers a mock with a valid bodySchema and echoes it in the 201', async () => {
    const bodySchema = {
      type: 'object',
      required: ['name'],
      properties: { name: { type: 'string' } },
    };
    const res = await POST(postRequest({ method: 'POST', uri: '/orders', bodySchema }));
    expect(res.status).toBe(201);
    const created = (await res.json()) as Record<string, unknown>;
    expect(created.bodySchema).toEqual(bodySchema);
    expect(getStore().list()[0].bodySchema).toEqual(bodySchema);
  });

  it('rejects an invalid bodySchema with 400 and registers nothing', async () => {
    for (const bodySchema of [{ type: 'nope' }, 'not-an-object', 42]) {
      const res = await POST(postRequest({ method: 'POST', uri: '/orders', bodySchema }));
      expect(res.status, JSON.stringify(bodySchema)).toBe(400);
      const body = (await res.json()) as { error: { details: { field: string }[] } };
      expect(body.error.details.some((d) => d.field === 'bodySchema')).toBe(true);
    }
    expect(getStore().list()).toEqual([]);
  });

  it('registers a mock with a valid responseSchema and echoes it in the 201', async () => {
    const responseSchema = {
      type: 'object',
      required: ['id', 'name'],
      properties: { id: { type: 'integer' }, name: { type: 'string' } },
    };
    const res = await POST(postRequest({ method: 'GET', uri: '/users/:id', responseSchema }));
    expect(res.status).toBe(201);
    const created = (await res.json()) as Record<string, unknown>;
    expect(created.responseSchema).toEqual(responseSchema);
    expect(getStore().list()[0].responseSchema).toEqual(responseSchema);
  });

  it('rejects an invalid responseSchema with 400 and registers nothing', async () => {
    for (const responseSchema of [{ type: 'nope' }, 'not-an-object', 42]) {
      const res = await POST(postRequest({ method: 'GET', uri: '/gen', responseSchema }));
      expect(res.status, JSON.stringify(responseSchema)).toBe(400);
      const body = (await res.json()) as { error: { details: { field: string }[] } };
      expect(body.error.details.some((d) => d.field === 'responseSchema')).toBe(true);
    }
    expect(getStore().list()).toEqual([]);
  });

  it('rejects a payload combining body and responseSchema with 400 and registers nothing', async () => {
    const res = await POST(
      postRequest({
        method: 'GET',
        uri: '/gen',
        body: { static: true },
        responseSchema: { type: 'object' },
      }),
    );
    expect(res.status).toBe(400);
    const payload = (await res.json()) as { error: { details: { field: string; message: string }[] } };
    const conflict = payload.error.details.find((d) => /cannot be combined/.test(d.message));
    expect(conflict?.field).toBe('responseSchema');
    expect(conflict?.message).toContain('body');
    expect(getStore().list()).toEqual([]);
  });
});

describe('GET /_mocks', () => {
  it('returns an empty array for an empty store', async () => {
    const res = GET();
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('application/json');
    expect(await res.json()).toEqual([]);
  });

  it('lists mocks oldest registration first with public fields', async () => {
    getStore().add({ method: 'GET', uri: '/seeded', body: 'seed' });
    await POST(postRequest({ method: 'POST', uri: '/runtime', status: 202 }));

    const res = GET();
    const list = (await res.json()) as Record<string, unknown>[];
    expect(list).toHaveLength(2);
    expect(list[0]).toMatchObject({ uri: '/seeded', method: 'GET', body: 'seed' });
    expect(list[1]).toMatchObject({ uri: '/runtime', method: 'POST', status: 202 });
    for (const item of list) {
      expect(item.id).toEqual(expect.any(String));
      expect(item).not.toHaveProperty('seq');
    }
  });

  it('round-trips a JSON object body losslessly', async () => {
    const body = { users: [{ id: 1, tags: ['a', null] }], total: 1 };
    await POST(postRequest({ method: 'GET', uri: '/data', body }));
    const list = (await GET().json()) as Record<string, unknown>[];
    expect(list[0].body).toEqual(body);
  });

  it('includes bodySchema in the listing for mocks that declare it', async () => {
    const bodySchema = { type: 'object', properties: { a: { type: 'integer' } } };
    await POST(postRequest({ method: 'POST', uri: '/with-schema', bodySchema }));
    await POST(postRequest({ method: 'GET', uri: '/without-schema' }));

    const list = (await GET().json()) as Record<string, unknown>[];
    expect(list[0].bodySchema).toEqual(bodySchema);
    expect('bodySchema' in list[1]).toBe(false);
  });

  it('includes responseSchema in the listing for mocks that declare it and omits it for others', async () => {
    const responseSchema = { type: 'object', properties: { a: { type: 'integer' } } };
    await POST(postRequest({ method: 'GET', uri: '/generated', responseSchema }));
    await POST(postRequest({ method: 'GET', uri: '/static', body: 'x' }));

    const list = (await GET().json()) as Record<string, unknown>[];
    expect(list[0].responseSchema).toEqual(responseSchema);
    expect('responseSchema' in list[1]).toBe(false);
  });
});

describe('DELETE /_mocks', () => {
  it('clears every mock including seeded ones and responds 204', async () => {
    getStore().add({ method: 'GET', uri: '/seeded' });
    await POST(postRequest({ method: 'GET', uri: '/runtime' }));

    const res = DELETE();
    expect(res.status).toBe(204);
    expect(getStore().list()).toEqual([]);
    expect(await GET().json()).toEqual([]);
  });
});
