interface RecordOptions {
    output?: string;
    node?: string;
    serve?: boolean;
    port?: string;
}
export declare function record(script: string, options: RecordOptions): Promise<void>;
export {};
