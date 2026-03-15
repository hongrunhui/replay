import { ReplaySession } from './session.js';
interface CDPMessage {
    id: number;
    method: string;
    params?: Record<string, unknown>;
}
interface CDPResponse {
    id: number;
    result?: Record<string, unknown>;
    error?: {
        code: number;
        message: string;
    };
}
export declare class CDPProtocolHandler {
    private session;
    constructor(session: ReplaySession);
    handleMessage(message: CDPMessage): Promise<CDPResponse>;
    private dispatch;
}
export {};
