import { beforeEach, describe, expect, it } from 'vitest';
import { getStore } from '../../../lib/store.ts';
import { DELETE } from './route.ts';

function deleteRequest(id: string): [Request, { params: Promise<{ id: string }> }] {
  return [
    new Request(`http://localhost/_mocks/${encodeURIComponent(id)}`, { method: 'DELETE' }),
    { params: Promise.resolve({ id }) },
  ];
}

beforeEach(() => {
  getStore().clearAll();
});

describe('DELETE /_mocks/{id}', () => {
  it('removes the mock and responds 204', async () => {
    const route = getStore().add({ method: 'GET', uri: '/gone' });
    const [req, ctx] = deleteRequest(route.id);

    const res = await DELETE(req, ctx);
    expect(res.status).toBe(204);
    expect(getStore().list()).toEqual([]);
  });

  it('responds 404 with a JSON error for an unknown id and changes nothing', async () => {
    const route = getStore().add({ method: 'GET', uri: '/kept' });
    const [req, ctx] = deleteRequest('does-not-exist');

    const res = await DELETE(req, ctx);
    expect(res.status).toBe(404);
    const payload = (await res.json()) as { error: { message: string } };
    expect(payload.error.message).toContain('does-not-exist');
    expect(getStore().list().map((r) => r.id)).toEqual([route.id]);
  });

  it('responds 404 when deleting the same id twice', async () => {
    const route = getStore().add({ method: 'GET', uri: '/once' });
    const [req1, ctx1] = deleteRequest(route.id);
    expect((await DELETE(req1, ctx1)).status).toBe(204);
    const [req2, ctx2] = deleteRequest(route.id);
    expect((await DELETE(req2, ctx2)).status).toBe(404);
  });

  it('leaves other mocks untouched', async () => {
    const first = getStore().add({ method: 'GET', uri: '/a' });
    const second = getStore().add({ method: 'GET', uri: '/b' });
    const [req, ctx] = deleteRequest(first.id);

    await DELETE(req, ctx);
    expect(getStore().list().map((r) => r.id)).toEqual([second.id]);
  });
});
