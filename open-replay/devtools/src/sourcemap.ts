// Simple source map parser
// Decodes VLQ-encoded mappings into a lookup table: generated line -> original position

export type OriginalPosition = {
  source: string;
  line: number;
  column: number;
};

export type SourceMapData = {
  version: number;
  file?: string;
  sourceRoot?: string;
  sources: string[];
  sourcesContent?: (string | null)[];
  names?: string[];
  mappings: string;
};

// Base64 VLQ decoding
const BASE64_CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
const BASE64_MAP = new Map<string, number>();
for (let i = 0; i < BASE64_CHARS.length; i++) {
  BASE64_MAP.set(BASE64_CHARS[i], i);
}

const VLQ_BASE_SHIFT = 5;
const VLQ_BASE = 1 << VLQ_BASE_SHIFT; // 32
const VLQ_CONTINUATION_BIT = VLQ_BASE; // 32
const VLQ_BASE_MASK = VLQ_BASE - 1; // 31

function decodeVLQ(encoded: string, index: number): [number, number] {
  let result = 0;
  let shift = 0;
  let continuation: boolean;
  let digit: number;

  do {
    if (index >= encoded.length) {
      throw new Error('Unexpected end of VLQ');
    }
    const charCode = BASE64_MAP.get(encoded[index++]);
    if (charCode === undefined) {
      throw new Error(`Invalid base64 character: ${encoded[index - 1]}`);
    }
    digit = charCode;
    continuation = !!(digit & VLQ_CONTINUATION_BIT);
    digit &= VLQ_BASE_MASK;
    result += digit << shift;
    shift += VLQ_BASE_SHIFT;
  } while (continuation);

  // Convert from VLQ signed representation
  const isNegative = result & 1;
  result >>= 1;
  return [isNegative ? -result : result, index];
}

/**
 * Parse a source map JSON and build a lookup table mapping
 * generated lines to their first original position.
 */
export function parseSourceMap(rawMap: SourceMapData): Map<number, OriginalPosition> {
  const result = new Map<number, OriginalPosition>();
  const { mappings, sources } = rawMap;

  if (!mappings || !sources || sources.length === 0) {
    return result;
  }

  const lines = mappings.split(';');

  // Running state across segments (as per source map spec)
  let sourceIndex = 0;
  let originalLine = 0;
  let originalColumn = 0;
  // nameIndex is tracked but unused for our line mapping
  let nameIndex = 0;

  for (let generatedLine = 0; generatedLine < lines.length; generatedLine++) {
    const line = lines[generatedLine];
    if (!line) continue;

    let generatedColumn = 0; // reset per generated line
    const segments = line.split(',');

    for (const segment of segments) {
      if (!segment) continue;

      let idx = 0;
      let value: number;

      // Field 1: generated column (always present)
      [value, idx] = decodeVLQ(segment, idx);
      generatedColumn += value;

      // If there are more fields, decode source mapping
      if (idx < segment.length) {
        // Field 2: source file index (delta)
        [value, idx] = decodeVLQ(segment, idx);
        sourceIndex += value;

        // Field 3: original line (delta)
        [value, idx] = decodeVLQ(segment, idx);
        originalLine += value;

        // Field 4: original column (delta)
        [value, idx] = decodeVLQ(segment, idx);
        originalColumn += value;

        // Field 5 (optional): name index (delta)
        if (idx < segment.length) {
          [value, idx] = decodeVLQ(segment, idx);
          nameIndex += value;
        }

        // Store the first mapping for this generated line
        if (!result.has(generatedLine)) {
          result.set(generatedLine, {
            source: sources[sourceIndex] || '',
            line: originalLine,
            column: originalColumn,
          });
        }
      }
    }
  }

  return result;
}

/**
 * Map hit counts from generated lines to original lines using a source map.
 * Returns a new hit counts object keyed by original line numbers.
 */
export function mapHitCountsToOriginal(
  hitCounts: Record<number, number>,
  lineMapping: Map<number, OriginalPosition>,
  targetSource?: string,
): Record<number, number> {
  const mapped: Record<number, number> = {};

  for (const [genLineStr, count] of Object.entries(hitCounts)) {
    const genLine = Number(genLineStr);
    const pos = lineMapping.get(genLine);
    if (pos) {
      // If targetSource is specified, only include mappings for that source
      if (targetSource && pos.source !== targetSource) continue;
      // Accumulate counts for the same original line
      mapped[pos.line] = (mapped[pos.line] || 0) + count;
    }
  }

  return mapped;
}
