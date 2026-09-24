import { findMatchingMock, normalizePath } from '../../lib/matcher.ts';
import { buildMockResponse, unmatchedResponse } from '../../lib/response.ts';
import { getStats } from '../../lib/stats.ts';
import { getStore } from '../../lib/store.ts';
import { isReservedPath } from '../../lib/validation.ts';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function handleMockRequest(req: Request): Response {
  const url = new URL(req.url);
  const path = normalizePath(url.pathname);
  // Reserved admin prefix: never matches a stored mock (defense in depth —
  // Next routes /_mocks and /_mocks/{id} to the admin handlers; unmapped
  // subpaths like /_mocks/a/b land here and get the unmatched JSON 404).
  if (isReservedPath(path)) {
    return unmatchedResponse(req.method, path);
  }
  const mock = findMatchingMock(getStore().list(), req.method, path);
  if (!mock) {
    // Journal unmatched calls by request path (design D18).
    getStats().record({ method: req.method, uri: path, matched: false, headers: req.headers });
    return unmatchedResponse(req.method, path);
  }
  // Journal matched calls under the registered pattern (design D18).
  getStats().record({ method: req.method, uri: mock.uri, matched: true, headers: req.headers });
  return buildMockResponse(mock, { omitBody: req.method === 'HEAD' });
}

export const GET = handleMockRequest;
export const POST = handleMockRequest;
export const PUT = handleMockRequest;
export const PATCH = handleMockRequest;
export const DELETE = handleMockRequest;
export const HEAD = handleMockRequest;
export const OPTIONS = handleMockRequest;
