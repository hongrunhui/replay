#!/usr/bin/env python3
"""
V8 Recording File Analyzer
Supports V2 (.v8rec, V8RE0002) and V3 (.v8rec, V8RE0003) formats.
"""

import sys
import struct
import os
from collections import defaultdict

# V2 event type names
EVENT_TYPE_NAMES_V2 = {
    0: 'WALL_CLOCK_TIME', 1: 'MONOTONIC_TIME',
    2: 'RANDOM_SEED', 3: 'THREAD_ID',
}

# V3 call type names
CALL_TYPE_NAMES_V3 = {
    0x0001: 'GETTIMEOFDAY', 0x0002: 'CLOCK_GETTIME',
    0x0003: 'MACH_ABSOLUTE_TIME', 0x0004: 'TIME',
    0x0010: 'ARC4RANDOM', 0x0011: 'ARC4RANDOM_BUF', 0x0012: 'GETENTROPY',
    0x0100: 'OPEN', 0x0101: 'CLOSE', 0x0102: 'READ', 0x0103: 'WRITE',
    0x0104: 'PREAD', 0x0105: 'PWRITE', 0x0106: 'STAT', 0x0107: 'FSTAT',
    0x0108: 'LSTAT', 0x0109: 'ACCESS', 0x010A: 'READLINK', 0x010B: 'GETCWD',
    0x0200: 'SOCKET', 0x0201: 'CONNECT', 0x0202: 'ACCEPT',
    0x0203: 'RECV', 0x0204: 'SEND', 0x0205: 'RECVFROM', 0x0206: 'SENDTO',
    0x0207: 'POLL', 0x0208: 'SELECT',
    0x0300: 'GETADDRINFO',
    0x0400: 'DLOPEN', 0x0401: 'DLSYM',
    0xFF00: 'RANDOM_SEED', 0xFF01: 'THREAD_ID',
}


class V2Analyzer:
    """Analyzer for V8RE0002 format (platform-level recording)."""

    def __init__(self, filename):
        self.filename = filename
        self.events = []
        self.header = None

    def analyze(self):
        with open(self.filename, 'rb') as f:
            self.header = self._read_header(f)
            self._read_events(f)
        self._print_results()

    def _read_header(self, f):
        magic = f.read(8).decode('ascii')
        if magic != 'V8RE0002':
            raise ValueError(f"Invalid magic: {magic}")
        version = struct.unpack('I', f.read(4))[0]
        timestamp = struct.unpack('Q', f.read(8))[0]
        event_count = struct.unpack('I', f.read(4))[0]
        flags = struct.unpack('I', f.read(4))[0]
        reserved = struct.unpack('I', f.read(4))[0]
        return {
            'magic': magic, 'version': version,
            'timestamp': timestamp, 'event_count': event_count,
            'flags': flags,
        }

    def _read_events(self, f):
        while True:
            raw = f.read(8)
            if len(raw) < 8:
                break
            sequence = struct.unpack('Q', raw)[0]
            raw_type = f.read(1)
            if len(raw_type) < 1:
                break
            event_type = struct.unpack('B', raw_type)[0]
            raw_len = f.read(2)
            if len(raw_len) < 2:
                break
            data_len = struct.unpack('H', raw_len)[0]
            data = f.read(data_len) if data_len > 0 else b''
            if len(data) < data_len:
                break
            self.events.append({
                'sequence': sequence,
                'type': event_type,
                'type_name': EVENT_TYPE_NAMES.get(event_type, f'UNKNOWN({event_type})'),
                'data_len': data_len,
                'data': data,
            })

    def _format_value(self, event):
        t = event['type']
        data = event['data']
        if t in (0, 1) and len(data) == 8:
            return f"{struct.unpack('d', data)[0]:.6f}"
        if t == 2 and len(data) >= 4:
            return str(struct.unpack('i', data[:4])[0])
        return data.hex() if data else ''

    def _print_results(self):
        import os
        h = self.header
        print(f"=== Recording File: {self.filename} ===")
        print(f"Format:    {h['magic']} (v{h['version']})")
        print(f"Timestamp: {h['timestamp']} ms since epoch")
        print(f"Events (header): {h['event_count']}")
        print(f"Events (actual): {len(self.events)}")
        print()
        type_counts = defaultdict(int)
        for e in self.events:
            type_counts[e['type_name']] += 1
        print("=== Event Breakdown ===")
        for name, count in sorted(type_counts.items()):
            print(f"  {name}: {count}")
        print()
        size = os.path.getsize(self.filename)
        print(f"=== File Size ===")
        print(f"  {size} bytes ({size/1024:.1f} KB)")
        print()
        limit = 20
        print(f"=== First {min(limit, len(self.events))} Events ===")
        for e in self.events[:limit]:
            val = self._format_value(e)
            print(f"  [{e['sequence']:4d}] {e['type_name']:<20s} = {val}")
        if len(self.events) > limit:
            print(f"  ... and {len(self.events) - limit} more events")
        print()


def detect_and_analyze(filename):
    with open(filename, 'rb') as f:
        magic = f.read(8).decode('ascii', errors='replace')
    if magic == 'V8RE0003':
        V3Analyzer(filename).analyze()
    elif magic == 'V8RE0002':
        V2Analyzer(filename).analyze()
    elif magic == 'V8REC001':
        print(f"V1 format detected. Use the old analyzer for .rec files.")
        sys.exit(1)
    else:
        print(f"Unknown format (magic: {magic!r})")
        sys.exit(1)


class V3Analyzer:
    """Analyzer for V8RE0003 format (libc-level interception)."""

    def __init__(self, filename):
        self.filename = filename
        self.calls = []
        self.header = None

    def analyze(self):
        with open(self.filename, 'rb') as f:
            self.header = self._read_header(f)
            self._read_calls(f)
        self._print_results()

    def _read_header(self, f):
        magic = f.read(8).decode('ascii')
        version = struct.unpack('I', f.read(4))[0]
        timestamp = struct.unpack('Q', f.read(8))[0]
        call_count = struct.unpack('I', f.read(4))[0]
        flags = struct.unpack('I', f.read(4))[0]
        reserved = struct.unpack('I', f.read(4))[0]
        return {'magic': magic, 'version': version, 'timestamp': timestamp,
                'call_count': call_count, 'flags': flags}

    def _read_calls(self, f):
        while True:
            raw = f.read(8)
            if len(raw) < 8: break
            seq = struct.unpack('Q', raw)[0]
            raw_type = f.read(2)
            if len(raw_type) < 2: break
            call_type = struct.unpack('H', raw_type)[0]
            raw_rval = f.read(4)
            if len(raw_rval) < 4: break
            rval = struct.unpack('i', raw_rval)[0]
            raw_dlen = f.read(4)
            if len(raw_dlen) < 4: break
            dlen = struct.unpack('I', raw_dlen)[0]
            data = f.read(dlen) if dlen > 0 else b''
            if len(data) < dlen: break
            self.calls.append({
                'seq': seq, 'type': call_type, 'rval': rval,
                'type_name': CALL_TYPE_NAMES_V3.get(call_type, f'0x{call_type:04X}'),
                'data_len': dlen, 'data': data,
            })

    def _print_results(self):
        h = self.header
        size = os.path.getsize(self.filename)
        print(f"=== Recording File: {self.filename} ===")
        print(f"Format:    {h['magic']} (v{h['version']}) — libc interception")
        print(f"Timestamp: {h['timestamp']} ms since epoch")
        print(f"Calls (header): {h['call_count']}")
        print(f"Calls (actual): {len(self.calls)}")
        print(f"File size: {size} bytes ({size/1024:.1f} KB)")
        print()

        # Category breakdown
        categories = defaultdict(lambda: defaultdict(int))
        for c in self.calls:
            t = c['type']
            if t <= 0x000F: cat = 'Time'
            elif t <= 0x001F: cat = 'Random'
            elif t <= 0x01FF: cat = 'File I/O'
            elif t <= 0x02FF: cat = 'Network'
            elif t <= 0x03FF: cat = 'DNS'
            elif t <= 0x04FF: cat = 'DynLib'
            else: cat = 'Meta'
            categories[cat][c['type_name']] += 1

        print("=== Call Breakdown ===")
        for cat in sorted(categories.keys()):
            total = sum(categories[cat].values())
            print(f"  [{cat}] ({total} calls)")
            for name, count in sorted(categories[cat].items()):
                print(f"    {name}: {count}")
        print()

        # Data volume
        total_data = sum(c['data_len'] for c in self.calls)
        print(f"=== Data Volume ===")
        print(f"  Total payload: {total_data} bytes ({total_data/1024:.1f} KB)")
        print(f"  Overhead (headers): {len(self.calls) * 18} bytes")
        print()

        # First N calls
        limit = 20
        print(f"=== First {min(limit, len(self.calls))} Calls ===")
        for c in self.calls[:limit]:
            print(f"  [{c['seq']:4d}] {c['type_name']:<20s} rval={c['rval']:<8d} data={c['data_len']}B")
        if len(self.calls) > limit:
            print(f"  ... and {len(self.calls) - limit} more calls")
        print()


def main():
    if len(sys.argv) < 2:
        print("Usage: python3 analyze.py <recording-file>")
        print("Supports: .v8rec (V2 platform-level, V3 libc-level)")
        sys.exit(1)
    try:
        detect_and_analyze(sys.argv[1])
    except FileNotFoundError:
        print(f"Error: File not found: {sys.argv[1]}")
        sys.exit(1)
    except Exception as e:
        print(f"Error: {e}")
        import traceback
        traceback.print_exc()
        sys.exit(1)


if __name__ == '__main__':
    main()
