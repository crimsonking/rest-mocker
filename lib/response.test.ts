import { describe, expect, it } from 'vitest';
import { adminErrorResponse, buildMockResponse, toMockJson, unmatchedResponse } from './response.ts';
import type { MockRoute } from './store.ts';

function route(overrides: Partial<MockRoute> = {}): MockRoute {
  return {
    id: 'id-1',
    method: 'GET',
    uri: '/x',
    status: 200,
    headers: {},
    seq: 1,
    ...overrides,
  };
}

describe('buildMockResponse', () => {
  it('serves status, headers, and body exactly as registered', async () => {
    const res = buildMockResponse(
      route({ status: 201, headers: { 'X-Trace': 'abc' }, body: { ok: true } }),
    );
    expect(res.status).toBe(201);
    expect(res.headers.get('X-Trace')).toBe('abc');
    expect(await res.json()).toEqual({ ok: true });
    expect(res.headers.get('content-type')).toBe('application/json');
  });

  it('serializes string bodies as text/plain verbatim', async () => {
    const res = buildMockResponse(route({ body: 'pong' }));
    expect(res.headers.get('content-type')).toBe('text/plain;charset=utf-8');
    expect(await res.text()).toBe('pong');
  });

  it('lets a registered Content-Type win over the default', async () => {
    const res = buildMockResponse(
      route({ headers: { 'Content-Type': 'application/xml' }, body: '<a/>' }),
    );
    expect(res.headers.get('content-type')).toBe('application/xml');
    expect(await res.text()).toBe('<a/>');
  });

  it('omits body and content-type when no body was registered', async () => {
    const res = buildMockResponse(route());
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBeNull();
    expect(await res.text()).toBe('');
  });

  it('keeps status and headers but drops the body for HEAD (omitBody)', async () => {
    const res = buildMockResponse(route({ status: 201, headers: { 'X-A': '1' }, body: { x: 1 } }), {
      omitBody: true,
    });
    expect(res.status).toBe(201);
    expect(res.headers.get('X-A')).toBe('1');
    expect(res.headers.get('content-type')).toBe('application/json');
    expect(await res.text()).toBe('');
  });

  it('does not crash on null-body statuses like 204 even when a body was registered', async () => {
    const res = buildMockResponse(route({ status: 204, body: 'ignored' }));
    expect(res.status).toBe(204);
    expect(await res.text()).toBe('');
  });
});

describe('unmatchedResponse', () => {
  it('is a 404 JSON payload naming method and path', async () => {
    const res = unmatchedResponse('GET', '/unknown');
    expect(res.status).toBe(404);
    expect(res.headers.get('content-type')).toBe('application/json');
    const payload = (await res.json()) as { error: { message: string; method: string; path: string } };
    expect(payload.error.method).toBe('GET');
    expect(payload.error.path).toBe('/unknown');
  });
});

describe('adminErrorResponse', () => {
  it('carries the message and optional field details', async () => {
    const res = adminErrorResponse(400, 'mock definition is invalid', [
      { field: 'method', message: 'method is required' },
    ]);
    expect(res.status).toBe(400);
    const payload = (await res.json()) as {
      error: { message: string; details: { field: string }[] };
    };
    expect(payload.error.message).toBe('mock definition is invalid');
    expect(payload.error.details[0].field).toBe('method');
  });
});

describe('toMockJson', () => {
  it('projects public fields and keeps body values lossless', () => {
    const body = { list: [1, { nested: null }] };
    const json = toMockJson(route({ body }));
    expect(json).toEqual({
      id: 'id-1',
      method: 'GET',
      uri: '/x',
      status: 200,
      headers: {},
      body,
    });
    expect(json).not.toHaveProperty('seq');
  });

  it('omits the body key when none was registered', () => {
    expect('body' in toMockJson(route())).toBe(false);
  });
});
