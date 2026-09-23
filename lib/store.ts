import { randomUUID } from 'node:crypto';
import type { HttpMethod, Json } from './types.ts';
import type { MockDefinition } from './validation.ts';

export interface MockRoute {
  id: string;
  method: HttpMethod;
  uri: string;
  status: number;
  headers: Record<string, string>;
  body?: Json;
  /** Monotonic registration counter: precedence tie-break and list ordering. */
  seq: number;
}

export class MockStore {
  private routes = new Map<string, MockRoute>();
  private counter = 0;

  add(def: MockDefinition): MockRoute {
    const route: MockRoute = {
      id: randomUUID(),
      method: def.method,
      uri: def.uri,
      status: def.status ?? 200,
      headers: { ...def.headers },
      ...(def.body !== undefined ? { body: def.body } : {}),
      seq: ++this.counter,
    };
    this.routes.set(route.id, route);
    return route;
  }

  /** All mocks, oldest registration first. */
  list(): MockRoute[] {
    return [...this.routes.values()].sort((a, b) => a.seq - b.seq);
  }

  deleteById(id: string): boolean {
    return this.routes.delete(id);
  }

  clearAll(): void {
    this.routes.clear();
  }
}

// String-keyed globalThis singleton so dev-mode HMR recompiles keep mock state
// (design D3). Const string literal keeps the computed-key type legal.
const STORE_KEY = '__mockE2eServerStore';

type StoreGlobal = { [STORE_KEY]?: MockStore };

export function getStore(): MockStore {
  const g = globalThis as StoreGlobal;
  g[STORE_KEY] ??= new MockStore();
  return g[STORE_KEY];
}
