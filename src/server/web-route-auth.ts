import { isIP } from 'node:net'

/** Header map as node and fetch present it. */
type HeaderMap = Record<string, string | undefined>

/** One route row the plugin registers on the host web server. */
export interface WebRoute {
  handler?: (request: NodeRequestLike, response: ServerResponseLike, ...args: unknown[]) => unknown
  resource?: (request: Request, ...args: unknown[]) => Response | Promise<Response>
  [key: string]: unknown
}

/** Minimal http request shape the handler wrapper adapts. */
interface NodeRequestLike {
  headers: HeaderMap
}

/** Minimal http response shape the handler wrapper answers with. */
interface ServerResponseLike {
  writeHead(status: number, headers: HeaderMap): unknown
  end(chunk?: string): unknown
}

/** Host web server surface this facade reads and registers on. */
interface WebServer {
  getOrigin(): string
  host?: string | null
  register(route: WebRoute): unknown
  [key: string]: unknown
}

/** Native DSH connection admission, when the host provides one. */
export interface WebConnection {
  allowsRemoteAuthorities?: boolean
  requestRejection?(request: { headers: HeaderMap }): number | undefined
}

/** Cordis context slice used by admission. */
export interface WebAuthContext {
  get?(name: string): unknown
  connection?: WebConnection
  logger?: { warn?(message: string): void }
}

/** Admission verdict for one request: pass, pass-needing-header-adaptation, or a rejection status. */
interface Admission {
  required?: boolean
  status?: number
}

function loopback(host: string | null | undefined): boolean {
  const value = String(host ?? '').replace(/^\[|\]$/g, '').toLowerCase()
  return value === 'localhost' || value === '::1' || (isIP(value) === 4 && value.startsWith('127.'))
}

function isWebConnection(value: unknown): value is WebConnection {
  return typeof value === 'object' && value !== null
}

function connectionFor(ctx: WebAuthContext): WebConnection | undefined {
  const service = typeof ctx.get === 'function' ? ctx.get('connection') : undefined
  return isWebConnection(service) ? service : ctx.connection
}

function admission(ctx: WebAuthContext, server: WebServer, request: { headers: HeaderMap }): Admission {
  try {
    const connection = connectionFor(ctx)
    const required = Boolean(process.env.WORKSTATION_DSH_LAN_AUTHORITY?.trim())
      || connection?.allowsRemoteAuthorities === true
      || (server.host != null && !loopback(server.host))
    if (!required) return { required: false }
    if (typeof connection?.requestRejection !== 'function') return { status: 503 }
    const status = connection.requestRejection(request)
    return status === undefined ? { required: true } : { status: status === 403 ? 403 : 401 }
  } catch {
    ctx.logger?.warn?.('private web route authentication failed')
    return { status: 503 }
  }
}

function legacyHeaders(server: WebServer, original: HeaderMap): HeaderMap {
  const origin = new URL(server.getOrigin())
  origin.hostname = '127.0.0.1'
  const headers: HeaderMap = { ...original, host: origin.host }
  if (headers.origin !== undefined) headers.origin = origin.origin
  return headers
}

/** Present the adapted headers to a legacy handler without mutating the original request. */
function nodeRequest<T extends object>(request: T, headers: HeaderMap): T {
  return new Proxy(request, {
    get(target, key) {
      if (key === 'headers') return headers
      const value = Reflect.get(target, key, target)
      return typeof value === 'function' ? value.bind(target) : value
    },
  })
}

/** Protect private plugin routes with native DSH admission before adapting legacy loopback guards.
 * The facade leaves the host server and private-only desktop transports unchanged.
 */
export function authenticatedWebServer<T extends object>(ctx: WebAuthContext, server: T): T {
  if (!server) return server
  // The wrapped object is the host web server; the facade only reads getOrigin/host and calls register.
  const target = server as unknown as WebServer
  return new Proxy(server, {
    get(_, key) {
      if (key !== 'register') {
        const value = Reflect.get(target, key, target)
        return typeof value === 'function' ? value.bind(target) : value
      }
      return (route: WebRoute) => {
        const wrapped: WebRoute = { ...route }
        if (route.handler) wrapped.handler = (request, response, ...args) => {
          const result = admission(ctx, target, request)
          if (result.status) {
            response.writeHead(result.status, { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store' })
            response.end(result.status === 503 ? 'authentication unavailable' : 'access denied')
            return
          }
          return route.handler!(result.required ? nodeRequest(request, legacyHeaders(target, request.headers)) : request, response, ...args)
        }
        if (typeof route.resource === 'function') wrapped.resource = (request, ...args) => {
          const original: Record<string, string> = {}
          for (const [key, value] of request.headers) original[key] = value
          const result = admission(ctx, target, { headers: original })
          if (result.status) return new Response('access denied', { status: result.status, headers: { 'cache-control': 'no-store' } })
          if (!result.required) return route.resource!(request, ...args)
          const headers = new Headers()
          for (const [key, value] of Object.entries(legacyHeaders(target, original))) if (value !== undefined) headers.set(key, value)
          return route.resource!(new Request(request, { headers }), ...args)
        }
        return target.register(wrapped)
      }
    },
  })
}
