import { readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { getRecordingsDir } from './utils.js';

interface ListOptions {
  dir?: string;
}

export function list(options: ListOptions) {
  const dir = options.dir || getRecordingsDir();

  let files: string[];
  try {
    files = readdirSync(dir).filter(f => f.endsWith('.orec'));
  } catch {
    console.log('No recordings found.');
    return;
  }

  if (files.length === 0) {
    console.log('No recordings found.');
    return;
  }

  console.log(`Recordings in ${dir}:\n`);
  console.log('  ID                                    Size      Date');
  console.log('  ' + '-'.repeat(70));

  for (const file of files.sort()) {
    const fullPath = join(dir, file);
    const stat = statSync(fullPath);
    const id = file.replace('.orec', '');
    const size = formatSize(stat.size);
    const date = stat.mtime.toISOString().replace('T', ' ').slice(0, 19);
    console.log(`  ${id}  ${size.padStart(8)}  ${date}`);
  }

  console.log(`\n  Total: ${files.length} recording(s)`);
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
