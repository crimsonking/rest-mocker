// Prestart gate (design D6): runs the same config loader as the
// instrumentation hook so an invalid mocks file stops `npm run dev` /
// `npm start` before the server listens. Run natively by Node (type stripping).
import { readConfigEntries, resolveConfigPath } from '../lib/config.ts';

try {
  const configPath = resolveConfigPath();
  const entries = readConfigEntries(configPath);
  console.log(
    `[mocks] config OK: ${configPath} (${entries.length} mock definition${entries.length === 1 ? '' : 's'})`,
  );
} catch (err) {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
}
