interface ReplayOptions {
    port?: string;
    server?: boolean;
    node?: string;
}
export declare function replay(recording: string, options: ReplayOptions): Promise<void>;
export declare const serve: typeof replay;
export {};
