import { spawn } from 'node:child_process';
import { resolve, join } from 'node:path';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { getDriverPath, getRecordingsDir, getNodePath } from './utils.js';

interface ReplayOptions {
  port?: string;
  server?: boolean;
  debug?: boolean;
  inspectPort?: string;
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
// Parse recording metadata (scriptPath, randomSeed, etc.)
function getRecordingMetadata(recordingPath: string): { scriptPath?: string; randomSeed?: number } {
  try {
    const buf = readFileSync(recordingPath);
    let i = 64;
    while (i + 9 <= buf.length - 32) {
      const type = buf[i];
      const dataLen = buf.readUInt32LE(i + 5);
      if (type === 0x20) {
        return JSON.parse(buf.subarray(i + 9, i + 9 + dataLen).toString('utf8'));
      }
      i += 9 + dataLen;
    }
  } catch { /* ignore */ }
  return {};
}

// Direct replay: run the script with the driver in replay mode
async function directReplay(recordingPath: string, options: ReplayOptions) {
  const driverPath = getDriverPath();
  if (!existsSync(driverPath)) {
    console.error(`Driver not found: ${driverPath}`);
    console.error('Run: cd driver && bash build.sh');
    process.exit(1);
  }

  const meta = getRecordingMetadata(recordingPath);
  if (!meta.scriptPath) {
    console.error('No script path found in recording metadata.');
    console.error('This recording may have been created with an older driver version.');
    process.exit(1);
  }

  if (!existsSync(meta.scriptPath)) {
    console.error(`Script not found: ${meta.scriptPath}`);
    process.exit(1);
  }

  const nodeBin = options.node || getNodePath();
  const env: Record<string, string> = {
    ...process.env as Record<string, string>,
  };

  // Always inject driver — patched Node.js v20 supports driver + inspector coexistence.
  // (System Node.js v22 had DYLD+inspector conflict, but patched v20 works.)
  env.OPENREPLAY_MODE = 'replay';
  env.REPLAY_RECORDING = recordingPath;
  if (process.platform === 'darwin') {
    env.DYLD_INSERT_LIBRARIES = driverPath;
  } else {
    env.LD_PRELOAD = driverPath;
  }

  const inspectPort = options.inspectPort || '9229';

  const nodeArgs: string[] = [];
  if (meta.randomSeed) {
    nodeArgs.push(`--random-seed=${meta.randomSeed}`);
  }
  if (options.debug) {
    nodeArgs.push(`--inspect-brk=${inspectPort}`);
  }

  nodeArgs.push(meta.scriptPath);

  console.error(`Replaying: ${recordingPath}`);
  console.error(`Script: ${meta.scriptPath}`);
  if (meta.randomSeed) console.error(`Random seed: ${meta.randomSeed}`);
  if (options.debug) {
    console.error(`\nDebugger listening on ws://127.0.0.1:${inspectPort}`);
    console.error(`Open Chrome and navigate to: chrome://inspect`);
    console.error(`Or open: devtools://devtools/bundled/js_app.html?ws=127.0.0.1:${inspectPort}`);
    console.error(`\nWaiting for debugger to connect...`);
  }

  const child = spawn(nodeBin, nodeArgs, {
    env,
    stdio: ['inherit', 'inherit', 'pipe'],
  });

  // Filter out openreplay messages from stderr (keep inspector + errors)
  child.stderr?.on('data', (data: Buffer) => {
    const text = data.toString();
    for (const line of text.split('\n')) {
      if (line.trim() && !line.startsWith('[openreplay]')) {
        process.stderr.write(line + '\n');
      }
    }
  });

  // In debug mode, wait for the child to exit (it won't until debugger disconnects)
  if (options.debug) {
    return; // Don't set up close handler — let the process run interactively
  }

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
  // Dynamic import to avoid compile-time dependency on server package
  let startServer: (opts: { port: number; recordingPath: string }) => Promise<unknown>;
  try {
    const mod = await (Function('p', 'return import(p)') as (p: string) => Promise<any>)(
      '../../server/src/index.js'
    );
    startServer = mod.startServer;
  } catch {
    console.error('Server module not available. Install server dependencies first.');
    process.exit(1);
  }
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
