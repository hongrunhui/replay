interface ServeOptions {
  port: string;
  devtools?: boolean;
}

export function serve(recording: string, options: ServeOptions) {
  const port = parseInt(options.port, 10);
  console.log(`Starting replay server for: ${recording}`);
  console.log(`WebSocket: ws://localhost:${port}`);

  // TODO: Phase 4 implementation
  // 1. Start fork Node.js in REPLAYING mode
  // 2. Connect to Node Inspector via --inspect
  // 3. Start WebSocket server for CDP protocol
  // 4. Bridge CDP messages between DevTools and Node Inspector

  console.log('\nReplay server not yet implemented (Phase 4)');
  console.log('Use the driver directly for now:');
  console.log(`  OPENREPLAY_MODE=replay REPLAY_RECORDING=${recording} node`);
}
