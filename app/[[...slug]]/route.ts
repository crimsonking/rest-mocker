import { generateFromSchema } from '../../lib/body-gen.ts';
import { validateBody } from '../../lib/body-schema.ts';
import { findMatchingMock, normalizePath } from '../../lib/matcher.ts';
import {
  bodySchemaRejectionResponse,
  buildMockResponse,
  jsonResponse,
  unmatchedResponse,
} from '../../lib/response.ts';
import { getStats } from '../../lib/stats.ts';
import { getStore } from '../../lib/store.ts';
import type { Json } from '../../lib/types.ts';
import { isReservedPath } from '../../lib/validation.ts';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

async function handleMockRequest(req: Request): Promise<Response> {
  const url = new URL(req.url);
  const path = normalizePath(url.pathname);
  // Reserved admin prefix: never matches a stored mock (defense in depth —
  // Next routes /_mocks and /_mocks/{id} to the admin handlers; unmapped
  // subpaths like /_mocks/a/b land here and get the unmatched JSON 500).
  if (isReservedPath(path)) {
    return unmatchedResponse(req.method, path);
  }
  const mock = findMatchingMock(getStore().list(), req.method, path);
  if (!mock) {
    // Journal unmatched calls by request path (design D18).
    getStats().record({ method: req.method, uri: path, matched: false, headers: req.headers });
    return unmatchedResponse(req.method, path);
  }
  // Journal matched calls under the registered pattern (design D18) — before
  // body-schema validation so rejected calls still count as matched (D24).
  getStats().record({ method: req.method, uri: mock.uri, matched: true, headers: req.headers });
  if (mock.bodySchema !== undefined) {
    const violations = validateBody(mock.bodySchema, await req.text());
    if (violations !== null) {
      return bodySchemaRejectionResponse(req.method, path, violations);
    }
  }
  // Response generation (design D29): feed the existing assembly pipeline a
  // generated body; HEAD skips generation since its body is never served.
  if (mock.responseSchema !== undefined && req.method !== 'HEAD') {
    let generated: Json;
    try {
      generated = generateFromSchema(mock.responseSchema);
    } catch (err) {
      // Unreachable in practice: the schema passed trial generation at
      // registration (design D28); a failure here names the mock to act on.
      return jsonResponse(500, {
        error: {
          message: `responseSchema generation failed for mock ${mock.id}: ${
            err instanceof Error ? err.message : String(err)
          }`,
          method: req.method,
          path,
        },
      });
    }
    return buildMockResponse({ ...mock, body: generated });
  }
  return buildMockResponse(mock, { omitBody: req.method === 'HEAD' });
}

export const GET = handleMockRequest;
export const POST = handleMockRequest;
export const PUT = handleMockRequest;
export const PATCH = handleMockRequest;
export const DELETE = handleMockRequest;
export const HEAD = handleMockRequest;
export const OPTIONS = handleMockRequest;
