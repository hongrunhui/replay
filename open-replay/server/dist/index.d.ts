interface ServerOptions {
    port: number;
    recordingPath: string;
}
export declare function startServer(options: ServerOptions): Promise<import("http").Server<typeof import("http").IncomingMessage, typeof import("http").ServerResponse>>;
export {};
