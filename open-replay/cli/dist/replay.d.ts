interface ReplayOptions {
    port?: string;
    server?: boolean;
    debug?: boolean;
    inspectPort?: string;
    node?: string;
}
export declare function replay(recording: string, options: ReplayOptions): Promise<void>;
export declare const serve: typeof replay;
export {};
