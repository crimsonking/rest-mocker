import { jsonResponse } from '../../../lib/response.ts';
import { getStats } from '../../../lib/stats.ts';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** GET /_mocks/stats — aggregated call-statistics report (design D19/D20). */
export function GET(): Response {
  return jsonResponse(200, getStats().snapshot());
}

/** DELETE /_mocks/stats — reset the in-memory call journal (design D19/D20). */
export function DELETE(): Response {
  getStats().reset();
  return new Response(null, { status: 204 });
}
