import { ChildProcess } from 'node:child_process';
import WebSocket from 'ws';
interface CheckpointProcess {
    pid: number;
    port: number;
    line: number;
    child: ChildProcess;
    ws?: WebSocket;
}
export declare class CheckpointPool {
    private checkpoints;
    private recordingPath;
    private maxCheckpoints;
    constructor(recordingPath: string, maxCheckpoints?: number);
    get size(): number;
    findNearest(targetLine: number): CheckpointProcess | null;
    warmUp(totalLines: number, scriptFile: string): Promise<void>;
    private spawnCheckpoint;
    private getNodePath;
    private getDriverPath;
    private getWsUrl;
    destroy(): void;
}
export {};
