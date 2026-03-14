#!/usr/bin/env python3
"""
Open Replay — Patch Application Script

Applies text insertions to V8 source files.
Usage: python3 apply_patches.py --file <path> --patch <patch_file>

Patch file format (JSON):
{
  "insertions": [
    {
      "after": "pattern to find",
      "content": "text to insert after the pattern"
    }
  ],
  "replacements": [
    {
      "find": "text to find",
      "replace": "replacement text"
    }
  ]
}
"""

import argparse
import json
import sys
import os

def apply_patch(file_path, patch_path):
    with open(file_path, 'r') as f:
        content = f.read()

    with open(patch_path, 'r') as f:
        patch = json.load(f)

    original = content

    # Apply insertions
    for ins in patch.get('insertions', []):
        pattern = ins['after']
        new_text = ins['content']
        idx = content.find(pattern)
        if idx < 0:
            print(f"  WARNING: Pattern not found: {pattern[:60]}...")
            continue
        # Insert after the pattern (at end of the line containing it)
        end_of_line = content.find('\n', idx + len(pattern))
        if end_of_line < 0:
            end_of_line = len(content)
        content = content[:end_of_line + 1] + new_text + '\n' + content[end_of_line + 1:]
        print(f"  Inserted after: {pattern[:60]}...")

    # Apply replacements
    for rep in patch.get('replacements', []):
        find = rep['find']
        replace = rep['replace']
        if find in content:
            content = content.replace(find, replace, 1)
            print(f"  Replaced: {find[:60]}...")
        else:
            print(f"  WARNING: Not found for replacement: {find[:60]}...")

    if content != original:
        with open(file_path, 'w') as f:
            f.write(content)
        print(f"  Patched: {file_path}")
    else:
        print(f"  No changes: {file_path}")

def main():
    parser = argparse.ArgumentParser(description='Apply patches to V8 source files')
    parser.add_argument('--file', required=True, help='Source file to patch')
    parser.add_argument('--patch', required=True, help='Patch file (JSON)')
    args = parser.parse_args()

    if not os.path.exists(args.file):
        print(f"ERROR: File not found: {args.file}")
        sys.exit(1)
    if not os.path.exists(args.patch):
        print(f"ERROR: Patch not found: {args.patch}")
        sys.exit(1)

    apply_patch(args.file, args.patch)

if __name__ == '__main__':
    main()
