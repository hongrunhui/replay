interface RecordOptions {
    output?: string;
    node?: string;
}
export declare function record(script: string, options: RecordOptions): Promise<void>;
export {};
