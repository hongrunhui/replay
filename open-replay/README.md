# Open Replay

Open-source time-travel debugger for Node.js. Record a script execution once, then replay it deterministically with full debugging support -- step forward, step backward, inspect variables at any point in time.

## Quick Start

```bash
# Install the CLI
npm install -g openreplay-cli

# Record a script
openreplay record my-script.js

# List recordings
openreplay list

# Replay with Chrome DevTools debugger
openreplay replay <recording-id> --debug
```

## Features

- **Deterministic recording** — captures all non-deterministic inputs (file I/O, network, time, randomness) at the libc level via DYLD_INTERPOSE / LD_PRELOAD
- **Time-travel debugging** — step forward and backward through execution using V8 bytecode instrumentation and checkpoint restore
- **Chrome DevTools integration** — connect via `chrome://inspect` for a familiar debugging experience with breakpoints, variable inspection, and console output
- **Hit counts and coverage** — see how many times each line executed during the recording
- **Checkpoint-based fast jumps** — backward navigation uses pre-spawned checkpoint processes for near-instant jumps

## Architecture

```
cli/        TypeScript CLI (record, replay, list, delete)
server/     TypeScript replay server (CDP WebSocket bridge)
devtools/   React-based DevTools UI (source viewer, timeline)
driver/     C++ shared library (libopenreplay.dylib/.so)
patches/    V8 and Node.js patches for bytecode instrumentation
```

The driver intercepts libc calls (open, read, close, socket, time, random) during recording and replays them deterministically. V8 patches add progress counters and instrumentation opcodes that enable precise execution control during replay.

## Requirements

- **Node.js 20+** (patched build required for replay — see setup below)
- **macOS** (arm64 or x86_64) or **Linux** (x86_64)
- **C++17 compiler** (Xcode CLT on macOS, gcc/g++ on Linux)

## Development Setup

```bash
# Clone the repository
git clone https://github.com/anthropics/open-replay.git
cd open-replay

# Build the patched Node.js (downloads and patches automatically)
bash setup-node.sh

# Build the driver
cd driver && bash build.sh && cd ..

# Install CLI dependencies and build
cd cli && npm install && npm run build && cd ..

# Install server dependencies and build
cd server && npm install && npm run build && cd ..
```

### Manual recording (without CLI)

```bash
OPENREPLAY_MODE=record \
  DYLD_INSERT_LIBRARIES=./driver/build/libopenreplay.dylib \
  ./node/out/Release/node my-script.js
```

### Manual replay

```bash
OPENREPLAY_MODE=replay \
  OPENREPLAY_FILE=~/.openreplay/recordings/<uuid>/recording.orec \
  DYLD_INSERT_LIBRARIES=./driver/build/libopenreplay.dylib \
  ./node/out/Release/node my-script.js
```

## Recording Format

Recordings are stored in `~/.openreplay/recordings/<uuid>/` with a binary `.orec` file containing a 64-byte header, an event stream of intercepted syscalls, a checkpoint index, and a sentinel tail.

## License

MIT
