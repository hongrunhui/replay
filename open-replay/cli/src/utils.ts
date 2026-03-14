import { join } from 'node:path';
import { homedir } from 'node:os';
import { existsSync } from 'node:fs';

export function getRecordingsDir(): string {
  return join(homedir(), '.openreplay', 'recordings');
}

export function getDriverPath(): string {
  const base = join(__dirname, '..', '..', 'driver', 'build');
  if (process.platform === 'darwin') {
    return join(base, 'libopenreplay.dylib');
  }
  return join(base, 'libopenreplay.so');
}

// Prefer patched Node.js (v20) — compatible with driver + inspector.
// Falls back to system node if patched version not built.
export function getNodePath(): string {
  const patched = join(__dirname, '..', '..', 'node', 'out', 'Release', 'node');
  if (existsSync(patched)) return patched;
  return 'node';
}
