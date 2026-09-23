import { adminErrorResponse, jsonResponse, toMockJson } from '../../lib/response.ts';
import { getStore } from '../../lib/store.ts';
import { validateMockDefinition } from '../../lib/validation.ts';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** GET /_mocks — list every registered mock, oldest registration first. */
export function GET(): Response {
  return jsonResponse(
    200,
    getStore().list().map(toMockJson),
  );
}

/** POST /_mocks — register a mock from a JSON definition. */
export async function POST(req: Request): Promise<Response> {
  let payload: unknown;
  try {
    payload = await req.json();
  } catch {
    return adminErrorResponse(400, 'request body must be valid JSON');
  }
  const result = validateMockDefinition(payload);
  if (!result.ok) {
    return adminErrorResponse(400, 'mock definition is invalid', result.errors);
  }
  const route = getStore().add(result.value);
  return jsonResponse(201, toMockJson(route));
}

/** DELETE /_mocks — clear every mock, including config-seeded ones. */
export function DELETE(): Response {
  getStore().clearAll();
  return new Response(null, { status: 204 });
}
