import { unlinkSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { getRecordingsDir } from './utils.js';

export function deleteRecording(recording: string) {
  // If it's a UUID, look in the recordings dir
  let path = recording;
  if (!recording.includes('/')) {
    const dir = getRecordingsDir();
    path = join(dir, recording.endsWith('.orec') ? recording : `${recording}.orec`);
  }

  if (!existsSync(path)) {
    console.error(`Recording not found: ${path}`);
    process.exit(1);
  }

  unlinkSync(path);
  console.log(`Deleted: ${path}`);
}
