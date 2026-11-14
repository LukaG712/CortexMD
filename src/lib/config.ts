import fs from "node:fs";
import path from "node:path";

/** Resolve the persistent data root directory (overrideable via CORTEX_DATA_DIR). */
export function getDataDir(): string {
  const configured = process.env.CORTEX_DATA_DIR?.trim();
  const base = configured ? path.resolve(configured) : path.resolve(process.cwd(), "data");
  fs.mkdirSync(base, { recursive: true });
  return base;
}

/** Directory containing all plain Markdown workspace vaults. */
export function getVaultsDir(): string {
  const dir = path.join(getDataDir(), "vaults");
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

/** Directory for portable backups and exports. */
export function getBackupsDir(): string {
  const dir = path.join(getDataDir(), "backups");
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

/** Path to the embedded SQLite WAL database file. */
export function getDbPath(): string {
  return path.join(getDataDir(), "cortex.db");
}

/** Server-only secret used to encrypt provider API tokens at rest. */
export function getAppSecret(): string {
  return (
    process.env.APP_SECRET?.trim() ||
    "cortexmd-local-dev-secret-change-in-production-32bytes"
  );
}
