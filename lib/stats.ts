/** One aggregated journal row: who called which endpoint how often (design D16). */
export interface CallEntry {
  method: string;
  uri: string;
  matched: boolean;
  caller: string;
  count: number;
  lastCalledAt: string;
}

export interface RecordedCall {
  method: string;
  uri: string;
  matched: boolean;
  headers: Headers;
}

/** Wire shape of GET /_mocks/stats (design D20). */
export interface CallStatsReport {
  callerHeader: string;
  entries: CallEntry[];
}

// Composite key separator (design D16): newlines cannot appear in methods,
// URI paths, or header values, so the key is collision-safe.
const KEY_SEP = '\n';

export const DEFAULT_CALLER_HEADER = 'user-agent';
export const UNKNOWN_CALLER = 'unknown';

// HTTP token grammar (RFC 9110): an invalid configured header name would make
// Headers.get() throw, so it falls back to the default instead (design D17).
const HEADER_TOKEN = /^[!#$%&'*+\-.^_|~0-9A-Za-z]+$/;

/** MOCK_STATS_CALLER_HEADER env override, default user-agent (design D17). */
export function resolveCallerHeader(env: Record<string, string | undefined> = process.env): string {
  const name = env.MOCK_STATS_CALLER_HEADER;
  return name !== undefined && HEADER_TOKEN.test(name) ? name : DEFAULT_CALLER_HEADER;
}

/**
 * Caller identity from request headers: absent, empty, or whitespace-only
 * values record `unknown`; anything else is stored as-is (design D17).
 */
export function extractCaller(headers: Headers, headerName: string = resolveCallerHeader()): string {
  const value = headers.get(headerName);
  return value !== null && value.trim() !== '' ? value : UNKNOWN_CALLER;
}

/**
 * In-memory call journal (design D15/D16): one Map keyed by method, uri,
 * caller, and the matched flag — the flag is a key dimension so one
 * method+uri can hold separate matched and unmatched histories.
 */
export class CallJournal {
  private byKey = new Map<string, CallEntry>();

  /** Synchronous and never-throwing: recording cannot fail a request (design D18). */
  record(call: RecordedCall): void {
    const method = call.method.toUpperCase();
    const caller = extractCaller(call.headers);
    const key = [method, call.uri, caller, call.matched ? '1' : '0'].join(KEY_SEP);
    const lastCalledAt = new Date().toISOString();
    const existing = this.byKey.get(key);
    if (existing) {
      existing.count += 1;
      existing.lastCalledAt = lastCalledAt;
      return;
    }
    this.byKey.set(key, {
      method,
      uri: call.uri,
      matched: call.matched,
      caller,
      count: 1,
      lastCalledAt,
    });
  }

  /** Empties the journal; registered mocks are unaffected (design D20). */
  reset(): void {
    this.byKey.clear();
  }

  /** Copies of all entries in insertion order; report sorting lives in snapshot(). */
  entries(): CallEntry[] {
    return [...this.byKey.values()].map((entry) => ({ ...entry }));
  }

  /** Report for GET /_mocks/stats: count desc, then method/uri/caller asc (design D20). */
  snapshot(): CallStatsReport {
    return {
      callerHeader: resolveCallerHeader(),
      entries: this.entries().sort(compareEntries),
    };
  }
}

function compareText(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/** Deterministic report order (design D20): count desc, then method/uri/caller asc. */
function compareEntries(a: CallEntry, b: CallEntry): number {
  return (
    b.count - a.count ||
    compareText(a.method, b.method) ||
    compareText(a.uri, b.uri) ||
    compareText(a.caller, b.caller)
  );
}

// String-keyed globalThis singleton so dev-mode HMR recompiles keep one
// shared journal across route modules (design D15, mirrors getStore()).
// Const string literal keeps the computed-key type legal.
const STATS_KEY = '__mockE2eServerStats';

type StatsGlobal = { [STATS_KEY]?: CallJournal };

export function getStats(): CallJournal {
  const g = globalThis as StatsGlobal;
  g[STATS_KEY] ??= new CallJournal();
  return g[STATS_KEY];
}
