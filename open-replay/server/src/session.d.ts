import { ReplayEngine, PauseState } from './replay-engine.js';
interface ConsoleMessage {
    level: string;
    text: string;
    timestamp: number;
}
export declare class ReplaySession {
    private _recordingPath;
    private _sessionId;
    private _engine;
    private _consoleMessages;
    private _started;
    private _header;
    constructor(recordingPath: string);
    get id(): string;
    get recordingPath(): string;
    get engine(): ReplayEngine | null;
    start(): Promise<void>;
    startEngine(): Promise<void>;
    getDescription(): Record<string, unknown>;
    getSources(): Array<{
        sourceId: string;
        url: string;
    }>;
    getConsoleMessages(): ConsoleMessage[];
    getPauseState(): PauseState | null;
    isPaused(): boolean;
    runReplay(): Promise<{
        exitCode: number;
        stdout: string;
        stderr: string;
        messages: unknown[];
    }>;
    destroy(): Promise<void>;
}
export declare function listRecordings(): Array<{
    id: string;
    path: string;
    timestamp: number;
    size: number;
    buildId: string;
}>;
export {};
