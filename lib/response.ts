import type { MockRoute } from './store.ts';

export interface MockJson {
  id: string;
  method: string;
  uri: string;
  status: number;
  headers: Record<string, string>;
  body?: unknown;
}

/** Public projection of a stored mock for admin API responses. */
export function toMockJson(route: MockRoute): MockJson {
  const out: MockJson = {
    id: route.id,
    method: route.method,
    uri: route.uri,
    status: route.status,
    headers: { ...route.headers },
  };
  if (route.body !== undefined) out.body = route.body;
  return out;
}

// Statuses whose responses must not carry a body (fetch would throw otherwise).
const NULL_BODY_STATUSES: Record<number, true> = { 101: true, 204: true, 205: true, 304: true };

/**
 * Builds the HTTP response for a matched mock per design D7:
 * registered headers win; Content-Type defaults to application/json for
 * non-string bodies and text/plain for strings; `omitBody` serves HEAD.
 */
export function buildMockResponse(mock: MockRoute, opts: { omitBody?: boolean } = {}): Response {
  const headers = new Headers(mock.headers);
  const isStringBody = typeof mock.body === 'string';
  const bodyText =
    mock.body === undefined ? null : isStringBody ? mock.body : JSON.stringify(mock.body);
  if (bodyText !== null && !headers.has('content-type')) {
    headers.set('content-type', isStringBody ? 'text/plain;charset=utf-8' : 'application/json');
  }
  const informational = mock.status >= 100 && mock.status < 200;
  const mustOmitBody =
    opts.omitBody === true || bodyText === null || NULL_BODY_STATUSES[mock.status] === true || informational;
  return new Response(mustOmitBody ? null : bodyText, { status: mock.status, headers });
}

/** JSON 404 for requests no mock matches, naming method and path. */
export function unmatchedResponse(method: string, path: string): Response {
  return jsonResponse(404, {
    error: { message: 'no mock matches this request', method, path },
  });
}

/** JSON error for admin API failures, with optional field-level details. */
export function adminErrorResponse(
  status: number,
  message: string,
  details?: { field: string; message: string }[],
): Response {
  return jsonResponse(status, {
    error: details ? { message, details } : { message },
  });
}

export function jsonResponse(status: number, payload: unknown): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}
