import { spawn } from 'node:child_process';
import { resolve, dirname } from 'node:path';
import { existsSync } from 'node:fs';
import { getDriverPath, getRecordingsDir, getNodePath } from './utils.js';

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

  const nodeBin = options.node || getNodePath();
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

  // Generate a random seed for V8's Math.random() PRNG.
  // This seed is passed via --random-seed and stored in the recording metadata.
  // On replay, the same seed is used to produce identical Math.random() sequences.
  // Generate a random seed for V8's Math.random() PRNG.
  // Stored in metadata so replay can use the same seed.
  const randomSeed = Math.floor(Math.random() * 2147483647) + 1;
  env.OPENREPLAY_RANDOM_SEED = String(randomSeed);
  // Pass script path explicitly (argv[1] is now --random-seed, not the script)
  env.OPENREPLAY_SCRIPT = scriptPath;

  console.log(`Recording: ${scriptPath}`);
  console.log(`Driver: ${driverPath}`);

  const child = spawn(nodeBin, [`--random-seed=${randomSeed}`, scriptPath], {
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
