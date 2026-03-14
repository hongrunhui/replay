import { spawn } from 'node:child_process';
import { resolve, join } from 'node:path';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { getDriverPath, getRecordingsDir } from './utils.js';

interface ReplayOptions {
  port?: string;
  server?: boolean;
  node?: string;
}

// Resolve recording path from UUID or path
function resolveRecording(recording: string): string {
  if (existsSync(recording)) return resolve(recording);
  // Try as UUID
  const dir = getRecordingsDir();
  const withExt = recording.endsWith('.orec') ? recording : `${recording}.orec`;
  const candidate = join(dir, withExt);
  if (existsSync(candidate)) return candidate;
  // Try partial match
  if (existsSync(dir)) {
    const match = readdirSync(dir).find(f => f.startsWith(recording) && f.endsWith('.orec'));
    if (match) return join(dir, match);
  }
  return recording; // let it fail with a proper error
}

// Parse script path from recording metadata
function getScriptPath(recordingPath: string): string | null {
  try {
    const buf = readFileSync(recordingPath);
    let i = 64;
    while (i + 9 <= buf.length - 32) {
      const type = buf[i];
      const dataLen = buf.readUInt32LE(i + 5);
      if (type === 0x20) {
        const json = JSON.parse(buf.subarray(i + 9, i + 9 + dataLen).toString('utf8'));
        return json.scriptPath || null;
      }
      i += 9 + dataLen;
    }
  } catch { /* ignore */ }
  return null;
}

// Direct replay: run the script with the driver in replay mode
async function directReplay(recordingPath: string, options: ReplayOptions) {
  const driverPath = getDriverPath();
  if (!existsSync(driverPath)) {
    console.error(`Driver not found: ${driverPath}`);
    console.error('Run: cd driver && bash build.sh');
    process.exit(1);
  }

  const scriptPath = getScriptPath(recordingPath);
  if (!scriptPath) {
    console.error('No script path found in recording metadata.');
    console.error('This recording may have been created with an older driver version.');
    process.exit(1);
  }

  if (!existsSync(scriptPath)) {
    console.error(`Script not found: ${scriptPath}`);
    process.exit(1);
  }

  const nodeBin = options.node || 'node';
  const env: Record<string, string> = {
    ...process.env as Record<string, string>,
    OPENREPLAY_MODE: 'replay',
    REPLAY_RECORDING: recordingPath,
  };

  if (process.platform === 'darwin') {
    env.DYLD_INSERT_LIBRARIES = driverPath;
  } else {
    env.LD_PRELOAD = driverPath;
  }

  console.error(`Replaying: ${recordingPath}`);
  console.error(`Script: ${scriptPath}`);

  const child = spawn(nodeBin, [scriptPath], {
    env,
    stdio: ['inherit', 'inherit', 'pipe'],
  });

  // Filter out openreplay messages from stderr
  child.stderr?.on('data', (data: Buffer) => {
    const text = data.toString();
    for (const line of text.split('\n')) {
      if (line.trim() && !line.startsWith('[openreplay]')) {
        process.stderr.write(line + '\n');
      }
    }
  });

  child.on('close', (code) => {
    process.exit(code ?? 0);
  });

  child.on('error', (err) => {
    console.error(`Failed to start: ${err.message}`);
    process.exit(1);
  });
}

// Server replay: start WebSocket server for programmatic access
async function serverReplay(recordingPath: string, options: ReplayOptions) {
  const port = parseInt(options.port || '1234', 10);
  // Dynamic import the server module
  const { startServer } = await import('../../server/src/index.js');
  await startServer({ port, recordingPath });
}

export async function replay(recording: string, options: ReplayOptions) {
  const recordingPath = resolveRecording(recording);
  if (!existsSync(recordingPath)) {
    console.error(`Recording not found: ${recordingPath}`);
    process.exit(1);
  }

  if (options.server) {
    await serverReplay(recordingPath, options);
  } else {
    await directReplay(recordingPath, options);
  }
}

// Keep old name for backwards compatibility
export const serve = replay;
