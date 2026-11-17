import { isIP } from 'node:net';
function loopback(host) {
    const value = String(host ?? '').replace(/^\[|\]$/g, '').toLowerCase();
    return value === 'localhost' || value === '::1' || (isIP(value) === 4 && value.startsWith('127.'));
}
function isWebConnection(value) {
    return typeof value === 'object' && value !== null;
}
function connectionFor(ctx) {
    const service = typeof ctx.get === 'function' ? ctx.get('connection') : undefined;
    return isWebConnection(service) ? service : ctx.connection;
}
function admission(ctx, server, request) {
    try {
        const connection = connectionFor(ctx);
        const required = Boolean(process.env.WORKSTATION_DSH_LAN_AUTHORITY?.trim())
            || connection?.allowsRemoteAuthorities === true
            || (server.host != null && !loopback(server.host));
        if (!required)
            return { required: false };
        if (typeof connection?.requestRejection !== 'function')
            return { status: 503 };
        const status = connection.requestRejection(request);
        return status === undefined ? { required: true } : { status: status === 403 ? 403 : 401 };
    }
    catch {
        ctx.logger?.warn?.('private web route authentication failed');
        return { status: 503 };
    }
}
function legacyHeaders(server, original) {
    const origin = new URL(server.getOrigin());
    origin.hostname = '127.0.0.1';
    const headers = { ...original, host: origin.host };
    if (headers.origin !== undefined)
        headers.origin = origin.origin;
    return headers;
}
/** Present the adapted headers to a legacy handler without mutating the original request. */
function nodeRequest(request, headers) {
    return new Proxy(request, {
        get(target, key) {
            if (key === 'headers')
                return headers;
            const value = Reflect.get(target, key, target);
            return typeof value === 'function' ? value.bind(target) : value;
        },
    });
}
/** Protect private plugin routes with native DSH admission before adapting legacy loopback guards.
 * The facade leaves the host server and private-only desktop transports unchanged.
 */
export function authenticatedWebServer(ctx, server) {
    if (!server)
        return server;
    // The wrapped object is the host web server; the facade only reads getOrigin/host and calls register.
    const target = server;
    return new Proxy(server, {
        get(_, key) {
            if (key !== 'register') {
                const value = Reflect.get(target, key, target);
                return typeof value === 'function' ? value.bind(target) : value;
            }
            return (route) => {
                const wrapped = { ...route };
                if (route.handler)
                    wrapped.handler = (request, response, ...args) => {
                        const result = admission(ctx, target, request);
                        if (result.status) {
                            response.writeHead(result.status, { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store' });
                            response.end(result.status === 503 ? 'authentication unavailable' : 'access denied');
                            return;
                        }
                        return route.handler(result.required ? nodeRequest(request, legacyHeaders(target, request.headers)) : request, response, ...args);
                    };
                if (typeof route.resource === 'function')
                    wrapped.resource = (request, ...args) => {
                        const original = {};
                        for (const [key, value] of request.headers)
                            original[key] = value;
                        const result = admission(ctx, target, { headers: original });
                        if (result.status)
                            return new Response('access denied', { status: result.status, headers: { 'cache-control': 'no-store' } });
                        if (!result.required)
                            return route.resource(request, ...args);
                        const headers = new Headers();
                        for (const [key, value] of Object.entries(legacyHeaders(target, original)))
                            if (value !== undefined)
                                headers.set(key, value);
                        return route.resource(new Request(request, { headers }), ...args);
                    };
                return target.register(wrapped);
            };
        },
    });
}
