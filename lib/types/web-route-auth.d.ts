/** Header map as node and fetch present it. */
type HeaderMap = Record<string, string | undefined>;
/** One route row the plugin registers on the host web server. */
export interface WebRoute {
    handler?: (request: NodeRequestLike, response: ServerResponseLike, ...args: unknown[]) => unknown;
    resource?: (request: Request, ...args: unknown[]) => Response | Promise<Response>;
    [key: string]: unknown;
}
/** Minimal http request shape the handler wrapper adapts. */
interface NodeRequestLike {
    headers: HeaderMap;
}
/** Minimal http response shape the handler wrapper answers with. */
interface ServerResponseLike {
    writeHead(status: number, headers: HeaderMap): unknown;
    end(chunk?: string): unknown;
}
/** Native DSH connection admission, when the host provides one. */
export interface WebConnection {
    allowsRemoteAuthorities?: boolean;
    requestRejection?(request: {
        headers: HeaderMap;
    }): number | undefined;
}
/** Cordis context slice used by admission. */
export interface WebAuthContext {
    get?(name: string): unknown;
    connection?: WebConnection;
    logger?: {
        warn?(message: string): void;
    };
}
/** Protect private plugin routes with native DSH admission before adapting legacy loopback guards.
 * The facade leaves the host server and private-only desktop transports unchanged.
 */
export declare function authenticatedWebServer<T extends object>(ctx: WebAuthContext, server: T): T;
export {};
