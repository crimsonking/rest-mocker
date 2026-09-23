// Every test file gets its own throwaway database: the getStore() singleton
// resolves MOCK_DB_FILE lazily at first use, so setting it here — before any
// test module imports the store — keeps the repo-root mocks.db untouched.
// setupFiles run once per test file, so mkdtemp gives files running in
// parallel workers separate database files (design D11).
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

process.env.MOCK_DB_FILE = path.join(mkdtempSync(path.join(tmpdir(), 'mock-db-')), 'mocks.db');
