import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { getStore, type MockStore } from './store.ts';
import { validateMockDefinition, type MockDefinition } from './validation.ts';

export class ConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ConfigError';
  }
}

/** MOCK_CONFIG_FILE env override (relative paths resolve against cwd), default ./mocks.json. */
export function resolveConfigPath(
  env: Record<string, string | undefined> = process.env,
  cwd: string = process.cwd(),
): string {
  const fromEnv = env.MOCK_CONFIG_FILE;
  return fromEnv ? path.resolve(cwd, fromEnv) : path.join(cwd, 'mocks.json');
}

/**
 * Config form fork (design D32/D33): a bare array of definitions, or a
 * wrapper object with exactly `$schema` (optional string, never resolved at
 * runtime — it exists for editor tooling) and `mocks` (required array).
 * Anything else fails fast naming the file.
 */
function extractEntries(filePath: string, parsed: unknown): unknown[] {
  if (Array.isArray(parsed)) return parsed;
  if (typeof parsed !== 'object' || parsed === null) {
    throw new ConfigError(
      `Invalid mock config at ${filePath}: expected a JSON array of mock definitions or an object with a "mocks" array`,
    );
  }
  const wrapper = parsed as Record<string, unknown>;
  const unknownKeys = Object.keys(wrapper).filter((key) => key !== '$schema' && key !== 'mocks');
  if (unknownKeys.length > 0) {
    throw new ConfigError(
      `Invalid mock config at ${filePath}: unknown wrapper key${
        unknownKeys.length === 1 ? '' : 's'
      } ${unknownKeys.join(', ')} — only "$schema" and "mocks" are allowed`,
    );
  }
  if (wrapper.$schema !== undefined && typeof wrapper.$schema !== 'string') {
    throw new ConfigError(`Invalid mock config at ${filePath}: "$schema" must be a string`);
  }
  if (!Array.isArray(wrapper.mocks)) {
    throw new ConfigError(
      `Invalid mock config at ${filePath}: "mocks" must be a JSON array of mock definitions`,
    );
  }
  return wrapper.mocks;
}

/**
 * Reads and validates a config file into ordered mock definitions.
 * A missing file yields an empty list; anything invalid throws a
 * ConfigError naming the file path and, for bad entries, the entry index.
 */
export function readConfigEntries(filePath: string): MockDefinition[] {
  if (!existsSync(filePath)) return [];
  const text = readFileSync(filePath, 'utf8');
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (err) {
    throw new ConfigError(
      `Invalid mock config at ${filePath}: ${err instanceof Error ? err.message : 'malformed JSON'}`,
    );
  }
  return extractEntries(filePath, parsed).map((entry, index) => {
    const result = validateMockDefinition(entry);
    if (!result.ok) {
      const problems = result.errors.map((e) => `${e.field}: ${e.message}`).join('; ');
      throw new ConfigError(`Invalid mock config at ${filePath}: entry ${index} — ${problems}`);
    }
    return result.value;
  });
}

/**
 * Reads and validates the config file (always), then seeds the store in file
 * order only when the store is empty (design D13): a fresh database, or a
 * restart after clear-all. A non-empty store keeps its persisted state, so
 * `skipped` reports the entries that were validated but not inserted.
 */
export function seedStoreFromFile(
  filePath: string = resolveConfigPath(),
  store: MockStore = getStore(),
): { path: string; seeded: number; skipped: number } {
  const entries = readConfigEntries(filePath);
  if (entries.length > 0 && !store.isEmpty()) {
    return { path: filePath, seeded: 0, skipped: entries.length };
  }
  for (const entry of entries) {
    store.add(entry);
  }
  return { path: filePath, seeded: entries.length, skipped: 0 };
}
