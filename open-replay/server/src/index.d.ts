interface ServerOptions {
    port: number;
    recordingPath: string;
}
export declare function startServer(options: ServerOptions): Promise<import("ws").Server<typeof import("ws"), typeof import("http").IncomingMessage>>;
export {};
