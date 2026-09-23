import { describe, expect, it } from 'vitest';
import { findMatchingMock, matchPattern, normalizePath, splitPath } from './matcher.ts';
import type { MockRoute } from './store.ts';
import type { HttpMethod } from './types.ts';

let nextSeq = 0;

function mock(uri: string, method: HttpMethod = 'GET', overrides: Partial<MockRoute> = {}): MockRoute {
  return {
    id: `mock-${++nextSeq}`,
    method,
    uri,
    status: 200,
    headers: {},
    seq: nextSeq * 100,
    ...overrides,
  };
}

describe('normalizePath', () => {
  it('strips trailing slashes but preserves the root', () => {
    expect(normalizePath('/health/')).toBe('/health');
    expect(normalizePath('/a/b///')).toBe('/a/b');
    expect(normalizePath('/')).toBe('/');
  });

  it('decodes percent-encoding and falls back to raw on malformed input', () => {
    expect(normalizePath('/say%20hi')).toBe('/say hi');
    expect(normalizePath('/bad%zz')).toBe('/bad%zz');
  });
});

describe('splitPath', () => {
  it('splits into non-empty segments', () => {
    expect(splitPath('/')).toEqual([]);
    expect(splitPath('/users/42')).toEqual(['users', '42']);
    expect(splitPath('/a//b/')).toEqual(['a', 'b']);
  });
});

describe('matchPattern — single pattern', () => {
  it('matches exact segments', () => {
    expect(matchPattern(['health'], ['health'])).toBe(true);
    expect(matchPattern(['health'], ['Health'])).toBe(false);
    expect(matchPattern(['users', 'me'], ['users', 'me'])).toBe(true);
  });

  it('matches :param against exactly one segment', () => {
    expect(matchPattern(['users', ':id'], ['users', '42'])).toBe(true);
    expect(matchPattern(['users', ':id'], ['users'])).toBe(false);
    expect(matchPattern(['users', ':id'], ['users', '42', 'extra'])).toBe(false);
  });

  it('matches a final * against one or more remaining segments', () => {
    expect(matchPattern(['files', '*'], ['files', 'a'])).toBe(true);
    expect(matchPattern(['files', '*'], ['files', 'docs', 'a', 'b.png'])).toBe(true);
    expect(matchPattern(['files', '*'], ['files'])).toBe(false);
    expect(matchPattern(['*'], ['anything', 'depth'])).toBe(true);
  });

  it('does not treat a non-final * as a wildcard', () => {
    expect(matchPattern(['*', 'tail'], ['a', 'tail'])).toBe(false);
  });

  it('rejects segment-count mismatches', () => {
    expect(matchPattern(['a', 'b'], ['a'])).toBe(false);
    expect(matchPattern(['a'], ['a', 'b'])).toBe(false);
  });

  it('matches the root path with an empty pattern', () => {
    expect(matchPattern([], [])).toBe(true);
    expect(matchPattern([], ['a'])).toBe(false);
  });
});

describe('findMatchingMock — method matching', () => {
  const mocks = [mock('/health', 'GET')];

  it('matches the same method case-insensitively', () => {
    expect(findMatchingMock(mocks, 'get', '/health')?.id).toBe(mocks[0].id);
  });

  it('does not match a different method', () => {
    expect(findMatchingMock(mocks, 'POST', '/health')).toBeNull();
  });

  it('does not fall back from HEAD to a GET mock', () => {
    expect(findMatchingMock(mocks, 'HEAD', '/health')).toBeNull();
  });

  it('matches a HEAD-registered mock on HEAD only', () => {
    const head = mock('/health', 'HEAD');
    expect(findMatchingMock([head], 'HEAD', '/health')?.id).toBe(head.id);
    expect(findMatchingMock([head], 'GET', '/health')).toBeNull();
  });
});

describe('findMatchingMock — precedence (spec scenarios)', () => {
  it('exact beats path parameter', () => {
    const exact = mock('/users/me');
    const param = mock('/users/:id');
    expect(findMatchingMock([param, exact], 'GET', '/users/me')?.id).toBe(exact.id);
    expect(findMatchingMock([exact, param], 'GET', '/users/me')?.id).toBe(exact.id);
  });

  it('path parameter beats wildcard', () => {
    const param = mock('/users/:id');
    const wildcard = mock('/users/*');
    expect(findMatchingMock([wildcard, param], 'GET', '/users/42')?.id).toBe(param.id);
    expect(findMatchingMock([param, wildcard], 'GET', '/users/42')?.id).toBe(param.id);
  });

  it('latest registration wins on identical patterns', () => {
    const first = mock('/orders', 'GET', { seq: 1 });
    const second = mock('/orders', 'GET', { seq: 2 });
    expect(findMatchingMock([first, second], 'GET', '/orders')?.id).toBe(second.id);
  });

  it('exact beats wildcard across a shared prefix', () => {
    const exact = mock('/files/report.pdf');
    const wildcard = mock('/files/*');
    expect(findMatchingMock([wildcard, exact], 'GET', '/files/report.pdf')?.id).toBe(exact.id);
  });

  it('a wildcard still serves deeper paths the exact mock cannot', () => {
    const exact = mock('/files/report.pdf');
    const wildcard = mock('/files/*');
    expect(findMatchingMock([exact, wildcard], 'GET', '/files/nested/report.pdf')?.id).toBe(
      wildcard.id,
    );
  });

  it('returns null when nothing matches', () => {
    expect(findMatchingMock([mock('/health')], 'GET', '/unknown')).toBeNull();
  });

  it('matches a mock registered for the root path', () => {
    const root = mock('/');
    expect(findMatchingMock([root], 'GET', normalizePath('/'))?.id).toBe(root.id);
  });
});
