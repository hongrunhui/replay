// Open Replay — Node.js JS Runtime for Record/Replay
// This file is added to lib/internal/recordreplay/main.js
//
// Provides the JS-side API for record/replay, including:
// - CDP message handling
// - Object tracking
// - Source map collection

'use strict';

const {
  ObjectDefineProperty,
  SafeMap,
} = primordials;

// Binding to C++ layer
let binding;
try {
  binding = internalBinding('recordreplay');
} catch {
  // Not available — record/replay not enabled
  binding = null;
}

const isEnabled = binding !== null;
const isRecording = isEnabled && binding.isRecording();
const isReplaying = isEnabled && binding.isReplaying();

// Object ID tracking
const objectIds = new SafeMap();
let nextObjectId = 1;

function getObjectId(obj) {
  let id = objectIds.get(obj);
  if (id === undefined) {
    id = nextObjectId++;
    objectIds.set(obj, id);
  }
  return id;
}

// Source collection
const sources = new SafeMap();

function addSource(url, content) {
  if (!sources.has(url)) {
    sources.set(url, content);
  }
}

function getSources() {
  return [...sources.entries()].map(([url, content]) => ({ url, content }));
}

// Console message tracking
const consoleMessages = [];

function trackConsoleMessage(level, args, stack) {
  consoleMessages.push({
    level,
    args: args.map(a => typeof a === 'string' ? a : String(a)),
    stack,
    timestamp: Date.now(),
  });
}

// CDP message handling (for replay server communication)
function handleCDPMessage(message) {
  if (!binding) return;
  try {
    const parsed = JSON.parse(message);
    // Route to appropriate handler
    const response = processCDPMethod(parsed.method, parsed.params);
    if (response) {
      binding.sendCDPResponse(JSON.stringify({
        id: parsed.id,
        result: response,
      }));
    }
  } catch (e) {
    // Ignore malformed messages
  }
}

function processCDPMethod(method, params) {
  switch (method) {
    case 'Recording.getSources':
      return { sources: getSources() };
    case 'Console.getMessages':
      return { messages: consoleMessages };
    default:
      return null;
  }
}

// Initialize
function initialize() {
  if (!isEnabled) return;

  if (binding.setCDPCallback) {
    binding.setCDPCallback(handleCDPMessage);
  }

  // Wrap console methods to track messages
  const originalLog = console.log;
  const originalWarn = console.warn;
  const originalError = console.error;

  console.log = function(...args) {
    trackConsoleMessage('log', args, new Error().stack);
    return originalLog.apply(this, args);
  };
  console.warn = function(...args) {
    trackConsoleMessage('warn', args, new Error().stack);
    return originalWarn.apply(this, args);
  };
  console.error = function(...args) {
    trackConsoleMessage('error', args, new Error().stack);
    return originalError.apply(this, args);
  };
}

module.exports = {
  isEnabled,
  isRecording,
  isReplaying,
  initialize,
  getObjectId,
  addSource,
  getSources,
  trackConsoleMessage,
};
