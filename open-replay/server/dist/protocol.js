"use strict";
// Open Replay — CDP Protocol Handler
//
// Handles Chrome DevTools Protocol messages from the DevTools frontend.
// Routes to the ReplaySession/ReplayEngine for real data where available.
Object.defineProperty(exports, "__esModule", { value: true });
exports.CDPProtocolHandler = void 0;
const session_js_1 = require("./session.js");
const node_fs_1 = require("node:fs");
const node_path_1 = require("node:path");
function mapCDPProperty(p) {
    return {
        name: p.name,
        value: p.value?.value ?? p.value?.description ?? 'undefined',
        type: p.value?.type || 'unknown',
        subtype: p.value?.subtype,
        objectId: p.value?.objectId,
    };
}
async function buildObjectPreview(engine, objectId) {
    // First, get the object's own properties + internal properties
    const r = await engine.sendCDP('Runtime.getProperties', {
        objectId,
        ownProperties: true,
        generatePreview: true,
    });
    const ownProps = r?.result || [];
    const internalProps = r?.internalProperties || [];
    // Determine className from [[Prototype]] or the object description
    let className = 'Object';
    const protoInternal = internalProps.find((p) => p.name === '[[Prototype]]');
    if (protoInternal?.value?.className) {
        className = protoInternal.value.className;
    }
    // Fallback: evaluate constructor.name
    if (className === 'Object') {
        try {
            const ctorResult = await engine.sendCDP('Runtime.callFunctionOn', {
                objectId,
                functionDeclaration: 'function() { return this.constructor?.name || Object.prototype.toString.call(this); }',
                returnByValue: true,
            });
            const ctorName = ctorResult?.result?.value;
            if (ctorName && typeof ctorName === 'string' && ctorName !== 'Object') {
                className = ctorName;
            }
        }
        catch { /* ignore */ }
    }
    const MAX_PREVIEW_PROPS = 10;
    const properties = ownProps
        .filter((p) => p.name && !p.name.startsWith('__'))
        .slice(0, MAX_PREVIEW_PROPS + 1)
        .map(mapCDPProperty);
    const overflow = properties.length > MAX_PREVIEW_PROPS;
    if (overflow)
        properties.length = MAX_PREVIEW_PROPS;
    const preview = { properties, overflow };
    // --- Type-specific enrichment ---
    if (className === 'Array') {
        const lengthProp = ownProps.find((p) => p.name === 'length');
        if (lengthProp) {
            // Ensure length is in the properties list
            if (!preview.properties.find(p => p.name === 'length')) {
                preview.properties.push(mapCDPProperty(lengthProp));
            }
        }
    }
    if (className === 'Map' || className === 'Set') {
        const entriesInternal = internalProps.find((p) => p.name === '[[Entries]]');
        if (entriesInternal?.value?.objectId) {
            try {
                const entriesR = await engine.sendCDP('Runtime.getProperties', {
                    objectId: entriesInternal.value.objectId,
                    ownProperties: true,
                    generatePreview: true,
                });
                const entryItems = (entriesR?.result || []).filter((p) => /^\d+$/.test(p.name));
                preview.containerEntryCount = entryItems.length;
                const entries = [];
                for (const item of entryItems.slice(0, MAX_PREVIEW_PROPS)) {
                    if (item.value?.objectId) {
                        try {
                            const itemR = await engine.sendCDP('Runtime.getProperties', {
                                objectId: item.value.objectId,
                                ownProperties: true,
                            });
                            const keyProp = (itemR?.result || []).find((p) => p.name === 'key');
                            const valProp = (itemR?.result || []).find((p) => p.name === 'value');
                            const entry = {
                                value: { type: valProp?.value?.type || 'undefined', value: valProp?.value?.value ?? valProp?.value?.description },
                            };
                            if (keyProp) {
                                entry.key = { type: keyProp.value?.type || 'undefined', value: keyProp.value?.value ?? keyProp.value?.description };
                            }
                            entries.push(entry);
                        }
                        catch { /* skip entry */ }
                    }
                }
                preview.containerEntries = entries;
            }
            catch { /* ignore */ }
        }
    }
    if (className === 'Date') {
        try {
            const dateR = await engine.sendCDP('Runtime.callFunctionOn', {
                objectId,
                functionDeclaration: 'function() { return this.getTime(); }',
                returnByValue: true,
            });
            if (typeof dateR?.result?.value === 'number') {
                preview.dateTime = dateR.result.value;
            }
        }
        catch { /* ignore */ }
    }
    if (className === 'RegExp') {
        try {
            const regR = await engine.sendCDP('Runtime.callFunctionOn', {
                objectId,
                functionDeclaration: 'function() { return this.toString(); }',
                returnByValue: true,
            });
            if (typeof regR?.result?.value === 'string') {
                preview.regexpString = regR.result.value;
            }
        }
        catch { /* ignore */ }
    }
    if (className === 'Error' || className === 'TypeError' || className === 'RangeError' ||
        className === 'ReferenceError' || className === 'SyntaxError') {
        // Ensure name, message, stack are in properties
        for (const key of ['name', 'message', 'stack']) {
            if (!preview.properties.find(p => p.name === key)) {
                const prop = ownProps.find((p) => p.name === key);
                if (prop) {
                    preview.properties.push(mapCDPProperty(prop));
                }
            }
        }
    }
    if (className === 'Function') {
        try {
            const fnR = await engine.sendCDP('Runtime.callFunctionOn', {
                objectId,
                functionDeclaration: 'function() { return this.name || "(anonymous)"; }',
                returnByValue: true,
            });
            if (typeof fnR?.result?.value === 'string') {
                preview.functionName = fnR.result.value;
            }
        }
        catch { /* ignore */ }
        // Try to get function location
        try {
            const locR = await engine.sendCDP('Runtime.getProperties', {
                objectId,
                ownProperties: false,
            });
            const fnInternal = (locR?.internalProperties || []).find((p) => p.name === '[[FunctionLocation]]');
            if (fnInternal?.value) {
                preview.functionLocation = [{
                        sourceId: fnInternal.value.scriptId || '',
                        line: fnInternal.value.lineNumber || 0,
                        column: fnInternal.value.columnNumber || 0,
                    }];
            }
        }
        catch { /* ignore */ }
    }
    return { className, preview };
}
class CDPProtocolHandler {
    session;
    constructor(session) {
        this.session = session;
    }
    async handleMessage(message) {
        const { id, method, params } = message;
        try {
            const result = await this.dispatch(method, params || {});
            return { id, result };
        }
        catch (err) {
            return { id, error: { code: -32603, message: err.message || 'Internal error' } };
        }
    }
    async dispatch(method, params) {
        const engine = this.session.engine;
        switch (method) {
            // --- Session ---
            case 'Session.createSession':
                return { sessionId: this.session.id };
            case 'Session.releaseSession':
                await this.session.destroy();
                return {};
            // --- Recording ---
            case 'Recording.getDescription':
                return this.session.getDescription();
            case 'Recording.getSources':
                return { sources: this.session.getSources() };
            // Read a local file by path (for loading script source in DevTools UI)
            case 'Recording.readFile': {
                const filePath = params.path;
                try {
                    const { readFileSync } = await import('node:fs');
                    const contents = readFileSync(filePath, 'utf8');
                    return { contents, contentType: 'text/javascript' };
                }
                catch (e) {
                    return { contents: '', error: e.message };
                }
            }
            case 'Recording.getSourceContents': {
                if (engine) {
                    try {
                        const result = await engine.sendCDP('Debugger.getScriptSource', {
                            scriptId: params.sourceId,
                        });
                        return { contents: result?.scriptSource || '', contentType: 'text/javascript' };
                    }
                    catch { /* fall through */ }
                }
                return { contents: '', contentType: 'text/javascript' };
            }
            // --- Engine control ---
            case 'Recording.startEngine': {
                await this.session.startEngine();
                return { started: true };
            }
            // Run replay without debugger — just execute the script and capture output
            case 'Recording.run': {
                const result = await this.session.runReplay();
                return result;
            }
            case 'Recording.resume': {
                if (engine)
                    await engine.resume();
                return {};
            }
            case 'Recording.stepOver': {
                if (engine)
                    await engine.stepOver();
                return {};
            }
            case 'Recording.stepInto': {
                if (engine)
                    await engine.stepInto();
                return {};
            }
            // Time travel: restart replay and run to a specific line
            case 'Recording.runToLine': {
                const file = params.file;
                const line = params.line;
                // Ensure engine object exists (don't start it — runToLine does its own start)
                this.session.ensureEngine();
                const eng = this.session.engine;
                if (!eng)
                    throw new Error('Engine not available');
                try {
                    const state = await eng.runToLine(file, line);
                    if (!state)
                        return { paused: false, frames: [], reason: 'timeout or script ended' };
                    const top = state.frames[0];
                    // Use CDP console messages (more reliable than stdout buffering)
                    const cdpMessages = state.consoleMessages || [];
                    // Fallback to stdout if no CDP messages
                    let consoleOutput;
                    if (cdpMessages.length > 0) {
                        consoleOutput = cdpMessages.map((m, i) => ({
                            messageId: `cdp-${i}`,
                            level: m.level === 'warning' ? 'warn' : m.level,
                            text: m.text,
                            line: m.line,
                        }));
                    }
                    else {
                        const stdout = state.stdout || '';
                        consoleOutput = stdout.split('\n')
                            .filter((l) => l.trim())
                            .map((text, i) => ({
                            messageId: `stdout-${i}`,
                            level: 'log',
                            text,
                        }));
                    }
                    return {
                        paused: true,
                        line: top?.lineNumber ?? -1,
                        column: top?.columnNumber ?? 0,
                        functionName: top?.functionName || '(anonymous)',
                        frames: state.frames.map((f) => ({
                            frameId: f.callFrameId,
                            functionName: f.functionName,
                            line: f.lineNumber,
                            column: f.columnNumber,
                            url: f.url,
                        })),
                        console: consoleOutput,
                    };
                }
                catch (e) {
                    return { paused: false, frames: [], error: e.message };
                }
            }
            // --- SourceMap support ---
            case 'Recording.getSourceMap': {
                const sourceUrl = params.sourceUrl;
                if (!sourceUrl)
                    return { sourceMap: null };
                try {
                    // Strategy 1: look for <sourceUrl>.map next to the source
                    const mapPath = sourceUrl + '.map';
                    if ((0, node_fs_1.existsSync)(mapPath)) {
                        const raw = (0, node_fs_1.readFileSync)(mapPath, 'utf8');
                        return { sourceMap: JSON.parse(raw) };
                    }
                    // Strategy 2: parse //# sourceMappingURL= from the source file
                    if ((0, node_fs_1.existsSync)(sourceUrl)) {
                        const src = (0, node_fs_1.readFileSync)(sourceUrl, 'utf8');
                        const match = src.match(/\/\/[#@]\s*sourceMappingURL\s*=\s*(\S+)/);
                        if (match) {
                            const url = match[1];
                            const resolved = url.startsWith('/') ? url : (0, node_path_1.join)((0, node_path_1.dirname)(sourceUrl), url);
                            if ((0, node_fs_1.existsSync)(resolved)) {
                                const raw = (0, node_fs_1.readFileSync)(resolved, 'utf8');
                                return { sourceMap: JSON.parse(raw) };
                            }
                        }
                    }
                }
                catch { /* fall through */ }
                return { sourceMap: null };
            }
            case 'Recording.getOriginalSource': {
                const sourceMapUrl = params.sourceMapUrl;
                const originalSource = params.originalSource;
                if (!sourceMapUrl || !originalSource)
                    return { contents: '' };
                try {
                    if (!(0, node_fs_1.existsSync)(sourceMapUrl))
                        return { contents: '' };
                    const raw = (0, node_fs_1.readFileSync)(sourceMapUrl, 'utf8');
                    const map = JSON.parse(raw);
                    const sources = map.sources || [];
                    const sourcesContent = map.sourcesContent || [];
                    const idx = sources.indexOf(originalSource);
                    if (idx >= 0 && idx < sourcesContent.length) {
                        return { contents: sourcesContent[idx] };
                    }
                    // Try matching by basename
                    const baseName = originalSource.split('/').pop();
                    const idx2 = sources.findIndex(s => s.split('/').pop() === baseName);
                    if (idx2 >= 0 && idx2 < sourcesContent.length) {
                        return { contents: sourcesContent[idx2] };
                    }
                }
                catch { /* fall through */ }
                return { contents: '' };
            }
            case 'Recording.runToCompletion': {
                const runResult = await this.session.runReplay();
                const consoleMessages = runResult.messages;
                return {
                    exitCode: runResult.exitCode,
                    console: consoleMessages.map((m, i) => ({
                        messageId: `msg-${i}`,
                        level: m.level,
                        text: m.text,
                    })),
                };
            }
            // --- Debugger ---
            case 'Debugger.setBreakpoint': {
                if (engine) {
                    try {
                        const loc = params.location;
                        const result = await engine.sendCDP('Debugger.setBreakpoint', {
                            location: {
                                scriptId: loc?.sourceId,
                                lineNumber: loc?.line || 0,
                                columnNumber: loc?.column || 0,
                            },
                        });
                        return {
                            breakpointId: result?.breakpointId || `bp-${Date.now()}`,
                            actualLocation: loc,
                        };
                    }
                    catch { /* fall through */ }
                }
                const location = params.location;
                return {
                    breakpointId: `bp-${location?.sourceId}-${location?.line}`,
                    actualLocation: location,
                };
            }
            case 'Debugger.removeBreakpoint': {
                if (engine) {
                    try {
                        await engine.sendCDP('Debugger.removeBreakpoint', {
                            breakpointId: params.breakpointId,
                        });
                    }
                    catch { /* ignore */ }
                }
                return {};
            }
            // --- Pause ---
            case 'Pause.getAllFrames': {
                const pause = this.session.getPauseState();
                if (!pause)
                    return { frames: [], data: {} };
                return {
                    frames: pause.frames.map(f => ({
                        frameId: f.callFrameId,
                        functionName: f.functionName,
                        location: {
                            sourceId: f.url,
                            line: f.lineNumber,
                            column: f.columnNumber,
                        },
                    })),
                    data: {},
                };
            }
            case 'Pause.getScope': {
                const pause = this.session.getPauseState();
                if (!pause || !engine)
                    return { scopes: [], data: {} };
                const frameId = params.frameId;
                const frame = pause.frames.find(f => f.callFrameId === frameId);
                if (!frame)
                    return { scopes: [], data: {} };
                const scopes = [];
                for (const scope of frame.scopeChain || []) {
                    // Skip global scope (too many entries)
                    if (scope.type === 'global')
                        continue;
                    if (!scope.object?.objectId)
                        continue;
                    try {
                        const props = await engine.getProperties(scope.object.objectId);
                        const SKIP_VARS = new Set(['exports', 'require', 'module', '__filename', '__dirname', 'arguments']);
                        const bindings = props
                            .filter((p) => p.name && !p.name.startsWith('__') && !SKIP_VARS.has(p.name))
                            .map((p) => ({
                            name: p.name,
                            value: p.value?.value ?? p.value?.description ?? 'undefined',
                            type: p.value?.type || 'unknown',
                        }));
                        if (bindings.length > 0) {
                            scopes.push({ type: scope.type || 'unknown', bindings });
                        }
                    }
                    catch { /* ignore */ }
                }
                return { scopes, data: {} };
            }
            case 'Pause.evaluateInFrame': {
                if (!engine)
                    return { result: { value: undefined }, data: {} };
                const frameId = params.frameId;
                const expression = params.expression;
                try {
                    const result = await engine.evaluate(expression, frameId);
                    return { result: result, data: {} };
                }
                catch (e) {
                    return { result: { type: 'error', description: e.message }, data: {} };
                }
            }
            case 'Pause.getObjectPreview': {
                if (!engine)
                    return { data: {} };
                const objectId = params.objectId || params.object;
                if (!objectId)
                    return { data: {} };
                try {
                    const { className, preview } = await buildObjectPreview(engine, objectId);
                    return { objectId, className, preview, data: {} };
                }
                catch {
                    return { data: {} };
                }
            }
            // --- Console ---
            case 'Console.findMessages':
                return {
                    messages: this.session.getConsoleMessages().map((m, i) => ({
                        messageId: `msg-${i}`,
                        level: m.level,
                        text: m.text,
                        timestamp: m.timestamp,
                        point: '0',
                    })),
                };
            // Collect per-line execution counts by running replay with V8 coverage
            case 'Recording.collectHitCounts': {
                const file = params.file;
                this.session.ensureEngine();
                const eng = this.session.engine;
                if (!eng)
                    throw new Error('Engine not available');
                try {
                    const counts = await eng.collectHitCounts(file);
                    // Warm up checkpoint pool in background (for fast backward jumps later)
                    const totalLines = Object.keys(counts).length;
                    if (totalLines > 0) {
                        const info = await this.session.engine?.getRecordingInfo();
                        const scriptPath = info?.header?.scriptPath;
                        if (scriptPath) {
                            this.session.checkpointPool.warmUp(totalLines, scriptPath).catch(() => { });
                        }
                    }
                    return { counts };
                }
                catch (e) {
                    return { counts: {}, error: e.message };
                }
            }
            // Get detailed recording info
            case 'Recording.getRecordingInfo': {
                const desc = this.session.getDescription();
                return desc;
            }
            // Step over (single statement forward)
            case 'Debugger.stepOver': {
                if (engine) {
                    await engine.stepOver();
                    // Wait for pause event
                    await new Promise((resolve) => {
                        const h = () => resolve();
                        engine.once('paused', h);
                        setTimeout(() => { engine.off('paused', h); resolve(); }, 5000);
                    });
                    const pause = engine.getPauseState();
                    if (pause) {
                        const top = pause.frames[0];
                        return {
                            paused: true,
                            frames: pause.frames.map((f) => ({
                                frameId: f.callFrameId,
                                functionName: f.functionName,
                                line: f.lineNumber,
                                column: f.columnNumber,
                                url: f.url,
                            })),
                        };
                    }
                }
                return { paused: false };
            }
            // Step into
            case 'Debugger.stepInto': {
                if (engine) {
                    await engine.stepInto();
                    await new Promise((resolve) => {
                        const h = () => resolve();
                        engine.once('paused', h);
                        setTimeout(() => { engine.off('paused', h); resolve(); }, 5000);
                    });
                    const pause = engine.getPauseState();
                    if (pause) {
                        const top = pause.frames[0];
                        return {
                            paused: true,
                            frames: pause.frames.map((f) => ({
                                frameId: f.callFrameId,
                                functionName: f.functionName,
                                line: f.lineNumber,
                                column: f.columnNumber,
                                url: f.url,
                            })),
                        };
                    }
                }
                return { paused: false };
            }
            // Get specific object property (for lazy loading in variable tree)
            case 'Pause.getObjectProperty': {
                if (!engine)
                    return { result: undefined };
                const objectId = params.objectId;
                const propertyName = params.name;
                try {
                    const r = await engine.sendCDP('Runtime.getProperties', {
                        objectId,
                        ownProperties: true,
                    });
                    const prop = (r?.result || []).find((p) => p.name === propertyName);
                    if (prop) {
                        return {
                            result: {
                                value: prop.value?.value ?? prop.value?.description ?? 'undefined',
                                type: prop.value?.type || 'unknown',
                                objectId: prop.value?.objectId,
                            },
                        };
                    }
                    return { result: undefined };
                }
                catch {
                    return { result: undefined };
                }
            }
            // --- Debugger: additional methods ---
            case 'Debugger.getHitCounts': {
                const sourceId = params.sourceId;
                const locations = params.locations;
                // Delegate to collectHitCounts using the source URL
                this.session.ensureEngine();
                const eng = this.session.engine;
                if (!eng)
                    throw new Error('Engine not available');
                // Resolve sourceId to file path
                const sourceUrl = eng.scriptUrls.get(sourceId) || sourceId;
                const filePath = sourceUrl.startsWith('file://') ? sourceUrl.replace('file://', '') : sourceUrl;
                try {
                    const counts = await eng.collectHitCounts(filePath);
                    const hits = [];
                    if (locations && locations.length > 0) {
                        // Return counts only for requested locations
                        for (const loc of locations) {
                            const count = counts[loc.line] ?? 0;
                            hits.push({
                                location: { sourceId, line: loc.line, column: loc.column ?? 0 },
                                hits: count,
                            });
                        }
                    }
                    else {
                        // Return all non-zero counts
                        for (const [lineStr, count] of Object.entries(counts)) {
                            const line = parseInt(lineStr, 10);
                            hits.push({
                                location: { sourceId, line, column: 0 },
                                hits: count,
                            });
                        }
                    }
                    return { hits };
                }
                catch (e) {
                    return { hits: [], error: e.message };
                }
            }
            case 'Debugger.getPossibleBreakpoints': {
                if (!engine)
                    return { lineLocations: [] };
                const sourceId = params.sourceId;
                const range = params.range;
                try {
                    const cdpParams = {
                        start: {
                            scriptId: sourceId,
                            lineNumber: range?.start?.line ?? 0,
                            columnNumber: range?.start?.column ?? 0,
                        },
                    };
                    if (range?.end) {
                        cdpParams.end = {
                            scriptId: sourceId,
                            lineNumber: range.end.line,
                            columnNumber: range.end.column ?? 0,
                        };
                    }
                    const r = await engine.sendCDP('Debugger.getPossibleBreakpoints', cdpParams);
                    const locations = (r?.locations || []).map((loc) => ({
                        sourceId,
                        line: loc.lineNumber,
                        column: loc.columnNumber ?? 0,
                    }));
                    // Group by line for lineLocations format
                    const byLine = new Map();
                    for (const loc of locations) {
                        if (!byLine.has(loc.line))
                            byLine.set(loc.line, []);
                        byLine.get(loc.line).push(loc);
                    }
                    const lineLocations = Array.from(byLine.entries()).map(([line, columns]) => ({
                        line,
                        columns: columns.map(c => c.column),
                    }));
                    return { lineLocations };
                }
                catch {
                    return { lineLocations: [] };
                }
            }
            case 'Debugger.findSources': {
                return { sources: this.session.getSources() };
            }
            case 'Debugger.searchSourceContents': {
                const query = params.query;
                const sourceId = params.sourceId;
                if (!query)
                    return { matches: [] };
                const sources = this.session.getSources();
                const targetSources = sourceId
                    ? sources.filter(s => s.sourceId === sourceId)
                    : sources;
                const matches = [];
                const MAX_MATCHES = 100;
                for (const source of targetSources) {
                    if (matches.length >= MAX_MATCHES)
                        break;
                    // Try to read source contents
                    let contents = '';
                    const url = source.url;
                    const filePath = url.startsWith('file://') ? url.replace('file://', '') : url;
                    try {
                        if ((0, node_fs_1.existsSync)(filePath)) {
                            contents = (0, node_fs_1.readFileSync)(filePath, 'utf8');
                        }
                        else if (engine) {
                            // Fallback: get from engine
                            const r = await engine.sendCDP('Debugger.getScriptSource', {
                                scriptId: source.sourceId,
                            });
                            contents = r?.scriptSource || '';
                        }
                    }
                    catch {
                        continue;
                    }
                    if (!contents)
                        continue;
                    const lines = contents.split('\n');
                    const queryLower = query.toLowerCase();
                    for (let i = 0; i < lines.length && matches.length < MAX_MATCHES; i++) {
                        const line = lines[i];
                        const lineLower = line.toLowerCase();
                        let col = lineLower.indexOf(queryLower);
                        while (col !== -1 && matches.length < MAX_MATCHES) {
                            // Context: show some surrounding text
                            const ctxStart = Math.max(0, col - 20);
                            const ctxEnd = Math.min(line.length, col + query.length + 20);
                            matches.push({
                                sourceId: source.sourceId,
                                line: i,
                                column: col,
                                matchLength: query.length,
                                context: line.substring(ctxStart, ctxEnd),
                            });
                            col = lineLower.indexOf(queryLower, col + 1);
                        }
                    }
                }
                return { matches };
            }
            // --- Pause: additional methods ---
            case 'Pause.getFrameSteps': {
                // Complex analysis — return empty for now (requires progress counter integration)
                return { steps: [] };
            }
            case 'Pause.getTopFrame': {
                const pause = this.session.getPauseState();
                if (!pause?.frames?.length)
                    return { frame: null, data: {} };
                const f = pause.frames[0];
                return {
                    frame: {
                        frameId: f.callFrameId,
                        functionName: f.functionName,
                        location: {
                            sourceId: f.url,
                            line: f.lineNumber,
                            column: f.columnNumber,
                        },
                    },
                    data: {},
                };
            }
            case 'Pause.getExceptionValue': {
                if (engine) {
                    try {
                        // Check if we're paused on an exception
                        const pause = this.session.getPauseState();
                        if (pause?.frames?.length) {
                            const topFrame = pause.frames[0];
                            // Try evaluating the exception in the current frame
                            const r = await engine.sendCDP('Debugger.evaluateOnCallFrame', {
                                callFrameId: topFrame.callFrameId,
                                expression: '__error || (function() { try { throw undefined; } catch(e) { return e; } })()',
                                returnByValue: true,
                                generatePreview: true,
                                throwOnSideEffect: true,
                            });
                            if (r?.result && r.result.type !== 'undefined') {
                                return {
                                    exception: {
                                        value: r.result.value ?? r.result.description,
                                        type: r.result.type,
                                        className: r.result.className,
                                        objectId: r.result.objectId,
                                    },
                                    data: {},
                                };
                            }
                        }
                    }
                    catch { /* ignore — not paused on exception */ }
                }
                return { exception: null, data: {} };
            }
            // --- Analysis (stub — requires V8 progress counter integration) ---
            case 'Analysis.createAnalysis':
                return { analysisId: `analysis-${Date.now()}` };
            case 'Analysis.addLocation':
            case 'Analysis.runAnalysis':
                return {};
            // --- Graphics (not applicable for Node.js) ---
            case 'Graphics.getPaintContents':
                return { data: '' };
            // --- Internal ---
            case 'Recording.listRecordings':
            case 'Internal.listRecordings':
                return { recordings: (0, session_js_1.listRecordings)() };
            default:
                throw new Error(`Method not implemented: ${method}`);
        }
    }
}
exports.CDPProtocolHandler = CDPProtocolHandler;
//# sourceMappingURL=protocol.js.map