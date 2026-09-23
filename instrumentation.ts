export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    // Dynamic import is required here: the node-only config loader and
    // SQLite-backed store (fs/path/node:sqlite) must not enter this hook's
    // edge-runtime compilation, so a static top-level import cannot work.
    const { seedStoreFromFile } = await import('./lib/config.ts');
    try {
      const { path, seeded, skipped } = seedStoreFromFile();
      if (seeded > 0) {
        console.log(`[mocks] seeded ${seeded} mock(s) from ${path}`);
      } else if (skipped > 0) {
        console.log(
          `[mocks] store is not empty; skipped ${skipped} config entr${
            skipped === 1 ? 'y' : 'ies'
          } from ${path}`,
        );
      }
    } catch (err) {
      console.error(err instanceof Error ? err.message : String(err));
      // Next 15 logs an instrumentation failure but keeps the process alive;
      // exit explicitly so an invalid config or an unusable database (design
      // D14) never reaches a listening state.
      process.exit(1);
    }
  }
}
