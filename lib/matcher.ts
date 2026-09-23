import type { MockRoute } from './store.ts';

/** Decodes a pathname and strips trailing slashes (root "/" preserved). */
export function normalizePath(pathname: string): string {
  let decoded = pathname;
  try {
    decoded = decodeURIComponent(pathname);
  } catch {
    // Malformed percent-encoding: match on the raw pathname instead.
  }
  let normalized = decoded;
  while (normalized.length > 1 && normalized.endsWith('/')) {
    normalized = normalized.slice(0, -1);
  }
  return normalized;
}

/** Splits a normalized path into non-empty segments; "/" yields []. */
export function splitPath(path: string): string[] {
  return path.split('/').filter((segment) => segment !== '');
}

// Segment specificity per design D4: exact beats :param beats trailing *.
const SCORE_EXACT = 3;
const SCORE_PARAM = 2;
const SCORE_WILDCARD = 1;

function segmentScore(segment: string): number {
  if (segment === '*') return SCORE_WILDCARD;
  if (segment.startsWith(':')) return SCORE_PARAM;
  return SCORE_EXACT;
}

/**
 * True when the pattern's segments match the path's segments:
 * exact equality, `:param` for any single segment, and a final `*`
 * consuming one or more remaining segments.
 */
export function matchPattern(pattern: string[], pathSegments: string[]): boolean {
  for (let i = 0; i < pattern.length; i++) {
    const segment = pattern[i];
    if (segment === '*') {
      return i === pattern.length - 1 && pathSegments.length > i;
    }
    if (i >= pathSegments.length) return false;
    if (segment.startsWith(':')) continue;
    if (segment !== pathSegments[i]) return false;
  }
  return pattern.length === pathSegments.length;
}

/** True when pattern a (registered at seq aSeq) outranks pattern b. */
function outranks(a: string[], aSeq: number, b: string[], bSeq: number): boolean {
  const shared = Math.min(a.length, b.length);
  for (let i = 0; i < shared; i++) {
    const delta = segmentScore(a[i]) - segmentScore(b[i]);
    if (delta !== 0) return delta > 0;
  }
  if (a.length !== b.length) return a.length > b.length;
  return aSeq > bSeq;
}

/**
 * Selects the single best mock for a request: method equality (normalized
 * uppercase, strict — no GET→HEAD fallback), then pattern precedence
 * exact > :param > *, then most recent registration wins identical patterns.
 * `path` must already be normalized (no query string, no trailing slash).
 */
export function findMatchingMock(
  mocks: MockRoute[],
  method: string,
  path: string,
): MockRoute | null {
  const pathSegments = splitPath(path);
  const upperMethod = method.toUpperCase();
  let best: MockRoute | null = null;
  let bestPattern: string[] = [];
  for (const mock of mocks) {
    if (mock.method !== upperMethod) continue;
    const pattern = splitPath(mock.uri);
    if (!matchPattern(pattern, pathSegments)) continue;
    if (best === null || outranks(pattern, mock.seq, bestPattern, best.seq)) {
      best = mock;
      bestPattern = pattern;
    }
  }
  return best;
}
