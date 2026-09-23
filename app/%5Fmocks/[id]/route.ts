import { adminErrorResponse } from '../../../lib/response.ts';
import { getStore } from '../../../lib/store.ts';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

interface RouteContext {
  params: Promise<{ id: string }>;
}

/** DELETE /_mocks/{id} — remove one mock by its server-assigned id. */
export async function DELETE(_req: Request, ctx: RouteContext): Promise<Response> {
  const { id } = await ctx.params;
  const decodedId = decodeURIComponent(id);
  if (getStore().deleteById(decodedId)) {
    return new Response(null, { status: 204 });
  }
  return adminErrorResponse(404, `no mock with id "${decodedId}"`);
}
