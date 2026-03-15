import { EventEmitter } from 'node:events';
interface ReplayEngineOptions {
    recordingPath: string;
    nodePath?: string;
    driverPath?: string;
    scriptPath?: string;
}
export interface PauseState {
    frames: FrameInfo[];
    stdout: string;
    consoleMessages?: Array<{
        level: string;
        text: string;
        line?: number;
    }>;
}
export interface FrameInfo {
    callFrameId: string;
    functionName: string;
    url: string;
    lineNumber: number;
    columnNumber: number;
    scopeChain: ScopeInfo[];
}
interface ScopeInfo {
    type: string;
    object: {
        type: string;
        objectId?: string;
        description?: string;
    };
    name?: string;
}
export declare class ReplayEngine extends EventEmitter {
    private opts;
    private child;
    private ws;
    private nextMsgId;
    private pendingRequests;
    private cdpEventHandlers;
    private inspectorPort;
    private currentPause;
    readonly scriptUrls: Map<string, string>;
    capturedStdout: string;
    constructor(opts: ReplayEngineOptions);
    private getNodePath;
    private getDriverPath;
    private buildSpawnConfig;
    run(): Promise<{
        exitCode: number;
        stdout: string;
        stderr: string;
    }>;
    start(): Promise<void>;
    private waitForInspector;
    private connectWS;
    private handleWsMessage;
    sendCDP(method: string, params?: Record<string, unknown>): Promise<unknown>;
    onCDPEvent(method: string, handler: (params: unknown) => void): void;
    isPaused(): boolean;
    getPauseState(): PauseState | null;
    resume(): Promise<void>;
    stepOver(): Promise<void>;
    stepInto(): Promise<void>;
    evaluate(expression: string, callFrameId?: string): Promise<unknown>;
    getProperties(objectId: string): Promise<unknown[]>;
    collectHitCounts(targetFile: string): Promise<Record<number, number>>;
    runToCompletion(): Promise<number>;
    private forkCheckpointPids;
    runToLine(fileUrl: string, lineNumber: number): Promise<PauseState | null>;
    getRecordingInfo(): {
        path: string;
        size: number;
        header: ReturnType<typeof parseRecordingHeader>;
    };
    stop(): Promise<void>;
}
export declare function parseRecordingHeader(path: string): {
    magic: string;
    version: number;
    timestamp: number;
    buildId: string;
    scriptPath?: string;
    randomSeed?: number;
};
export {};
