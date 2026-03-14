import { spawn } from 'node:child_process';
import { resolve, dirname } from 'node:path';
import { existsSync } from 'node:fs';
import { getDriverPath, getRecordingsDir } from './utils.js';

interface RecordOptions {
  output?: string;
  node?: string;
}

export async function record(script: string, options: RecordOptions) {
  const driverPath = getDriverPath();
  if (!existsSync(driverPath)) {
    console.error(`Driver not found: ${driverPath}`);
    console.error('Run: cd driver && bash build.sh');
    process.exit(1);
  }

  const nodeBin = options.node || 'node';
  const scriptPath = resolve(script);

  if (!existsSync(scriptPath)) {
    console.error(`Script not found: ${scriptPath}`);
    process.exit(1);
  }

  const env: Record<string, string> = {
    ...process.env as Record<string, string>,
    OPENREPLAY_MODE: 'record',
  };

  if (options.output) {
    env.OPENREPLAY_RECORDING_PATH = resolve(options.output);
  }

  // On macOS, use DYLD_INSERT_LIBRARIES
  if (process.platform === 'darwin') {
    env.DYLD_INSERT_LIBRARIES = driverPath;
  } else {
    env.LD_PRELOAD = driverPath;
  }

  console.log(`Recording: ${scriptPath}`);
  console.log(`Driver: ${driverPath}`);

  const child = spawn(nodeBin, [scriptPath], {
    env,
    stdio: 'inherit',
  });

  child.on('close', (code) => {
    console.log(`\nRecording finished (exit code: ${code})`);
    console.log(`Recordings saved to: ${getRecordingsDir()}`);
  });

  child.on('error', (err) => {
    console.error(`Failed to start: ${err.message}`);
    process.exit(1);
  });
}
