import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import type { HttpMethod, Json } from './types.ts';
import type { MockDefinition } from './validation.ts';

export interface MockRoute {
  id: string;
  method: HttpMethod;
  uri: string;
  status: number;
  headers: Record<string, string>;
  body?: Json;
  bodySchema?: Json;
  responseSchema?: Json;
  /** Monotonic registration counter: precedence tie-break and list ordering. */
  seq: number;
}

/** MOCK_DB_FILE env override (relative paths resolve against cwd), default ./mocks.db (design D12). */
export function resolveDbPath(
  env: NodeJS.ProcessEnv = process.env,
  cwd: string = process.cwd(),
): string {
  const fromEnv = env.MOCK_DB_FILE;
  return fromEnv ? path.resolve(cwd, fromEnv) : path.join(cwd, 'mocks.db');
}

// Single table, JSON text columns (design D9): an absent body is SQL NULL,
// a registered JSON literal `null` body is the text 'null' — so the two
// round-trip distinctly. seq is UNIQUE: one process owns the file (design).
const SCHEMA_SQL = `CREATE TABLE IF NOT EXISTS mocks (
  id TEXT PRIMARY KEY,
  method TEXT NOT NULL,
  uri TEXT NOT NULL,
  status INTEGER NOT NULL,
  headers TEXT NOT NULL,
  body TEXT NULL,
  body_schema TEXT NULL,
  response_schema TEXT NULL,
  seq INTEGER NOT NULL UNIQUE
)`;

// Columns added by migrations after the original table shape; each is
// backfilled with ALTER TABLE on older databases (design D25/D30).
const MIGRATED_COLUMNS = ['body_schema', 'response_schema'] as const;

// Type alias, not interface: only a type literal carries the implicit index
// signature that makes the cast from node:sqlite's Record<string, SQLOutputValue>
// rows legal.
type MockRow = {
  id: string;
  method: string;
  uri: string;
  status: number;
  headers: string;
  body: string | null;
  body_schema: string | null;
  response_schema: string | null;
  seq: number;
};

export class MockStore {
  private db: DatabaseSync;
  /** In-process registration counter, continued from the persisted maximum (design D10). */
  private counter: number;

  constructor(location: string = resolveDbPath()) {
    const opened = MockStore.open(location);
    this.db = opened.db;
    this.counter = opened.counter;
  }

  // Open/initialize errors name the database path so startup fail-fast
  // messages are actionable (design D14).
  private static open(location: string): { db: DatabaseSync; counter: number } {
    let db: DatabaseSync;
    try {
      db = new DatabaseSync(location);
    } catch (err) {
      throw new Error(
        `Cannot open mock database at ${location}: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
    }
    try {
      db.exec('PRAGMA busy_timeout = 5000');
      db.exec(SCHEMA_SQL);
      // In-place migration for databases created before later columns existed
      // (design D25/D30): additive columns, idempotent, single owning process.
      const columns = db.prepare('PRAGMA table_info(mocks)').all() as { name: string }[];
      const present = new Set(columns.map((column) => column.name));
      for (const column of MIGRATED_COLUMNS) {
        if (!present.has(column)) {
          db.exec(`ALTER TABLE mocks ADD COLUMN ${column} TEXT NULL`);
        }
      }
      const row = db
        .prepare('SELECT COALESCE(MAX(seq), 0) AS maxSeq FROM mocks')
        .get() as { maxSeq: number } | undefined;
      return { db, counter: row?.maxSeq ?? 0 };
    } catch (err) {
      db.close();
      throw new Error(
        `Cannot initialize mock database at ${location}: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
    }
  }

  add(def: MockDefinition): MockRoute {
    const route: MockRoute = {
      id: randomUUID(),
      method: def.method,
      uri: def.uri,
      status: def.status ?? 200,
      headers: { ...def.headers },
      ...(def.body !== undefined ? { body: def.body } : {}),
      ...(def.bodySchema !== undefined ? { bodySchema: def.bodySchema } : {}),
      ...(def.responseSchema !== undefined ? { responseSchema: def.responseSchema } : {}),
      seq: ++this.counter,
    };
    this.db
      .prepare(
        'INSERT INTO mocks (id, method, uri, status, headers, body, body_schema, response_schema, seq) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
      )
      .run(
        route.id,
        route.method,
        route.uri,
        route.status,
        JSON.stringify(route.headers),
        route.body === undefined ? null : JSON.stringify(route.body),
        route.bodySchema === undefined ? null : JSON.stringify(route.bodySchema),
        route.responseSchema === undefined ? null : JSON.stringify(route.responseSchema),
        route.seq,
      );
    return route;
  }

  /** All mocks, oldest registration first. */
  list(): MockRoute[] {
    const rows = this.db
      .prepare(
        'SELECT id, method, uri, status, headers, body, body_schema, response_schema, seq FROM mocks ORDER BY seq',
      )
      .all() as MockRow[];
    return rows.map((row) => {
      const route: MockRoute = {
        id: row.id,
        method: row.method as HttpMethod,
        uri: row.uri,
        status: row.status,
        headers: JSON.parse(row.headers) as Record<string, string>,
        seq: row.seq,
      };
      if (row.body !== null) route.body = JSON.parse(row.body) as Json;
      if (row.body_schema !== null) route.bodySchema = JSON.parse(row.body_schema) as Json;
      if (row.response_schema !== null) route.responseSchema = JSON.parse(row.response_schema) as Json;
      return route;
    });
  }

  /** True when no mock is stored; drives seed-when-empty at startup (design D13). */
  isEmpty(): boolean {
    const row = this.db
      .prepare('SELECT EXISTS(SELECT 1 FROM mocks) AS hasRows')
      .get() as { hasRows: number } | undefined;
    return (row?.hasRows ?? 0) === 0;
  }

  deleteById(id: string): boolean {
    const result = this.db.prepare('DELETE FROM mocks WHERE id = ?').run(id);
    return Number(result.changes) > 0;
  }

  clearAll(): void {
    this.db.prepare('DELETE FROM mocks').run();
  }

  /** Closes the connection; reopening the same location models a restart (design D11). */
  close(): void {
    this.db.close();
  }
}

// String-keyed globalThis singleton so dev-mode HMR recompiles keep the mock
// store and its single open database connection (design D11, originally D3).
// Const string literal keeps the computed-key type legal.
const STORE_KEY = '__mockE2eServerStore';

type StoreGlobal = { [STORE_KEY]?: MockStore };

export function getStore(): MockStore {
  const g = globalThis as StoreGlobal;
  g[STORE_KEY] ??= new MockStore();
  return g[STORE_KEY];
}
