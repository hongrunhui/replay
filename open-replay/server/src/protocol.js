"use strict";
// Open Replay — CDP Protocol Handler
//
// Handles Chrome DevTools Protocol messages from the DevTools frontend.
// Routes to the ReplaySession/ReplayEngine for real data where available.
Object.defineProperty(exports, "__esModule", { value: true });
exports.CDPProtocolHandler = void 0;
const session_js_1 = require("./session.js");
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
            case 'Recording.runToCompletion': {
                if (engine) {
                    const exitCode = await engine.runToCompletion();
                    return { exitCode };
                }
                return { exitCode: 0 };
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
                    return { scope: { bindings: [] }, data: {} };
                const frameId = params.frameId;
                const frame = pause.frames.find(f => f.callFrameId === frameId);
                if (!frame)
                    return { scope: { bindings: [] }, data: {} };
                const bindings = [];
                for (const scope of frame.scopeChain || []) {
                    if (scope.type === 'local' && scope.object?.objectId) {
                        try {
                            const props = await engine.getProperties(scope.object.objectId);
                            for (const p of props) {
                                if (p.enumerable !== false) {
                                    bindings.push({ name: p.name, value: p.value?.value ?? p.value?.description });
                                }
                            }
                        }
                        catch { /* ignore */ }
                    }
                }
                return { scope: { bindings }, data: {} };
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
                try {
                    const props = await engine.getProperties(params.objectId);
                    return { data: { properties: props } };
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
            case 'Internal.listRecordings':
                return { recordings: (0, session_js_1.listRecordings)() };
            default:
                throw new Error(`Method not implemented: ${method}`);
        }
    }
}
exports.CDPProtocolHandler = CDPProtocolHandler;
//# sourceMappingURL=protocol.js.map