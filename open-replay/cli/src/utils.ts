import { join } from 'node:path';
import { homedir } from 'node:os';

export function getRecordingsDir(): string {
  return join(homedir(), '.openreplay', 'recordings');
}

export function getDriverPath(): string {
  // Look for driver relative to CLI package
  const base = join(__dirname, '..', '..', 'driver', 'build');
  if (process.platform === 'darwin') {
    return join(base, 'libopenreplay.dylib');
  }
  return join(base, 'libopenreplay.so');
}
