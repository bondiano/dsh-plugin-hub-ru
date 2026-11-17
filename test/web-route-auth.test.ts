import assert from 'node:assert/strict'
import { test } from 'node:test'
import { Readable } from 'node:stream'
import { authenticatedWebServer } from '../lib/web-route-auth.js'

const lan = '192.168.1.6:3344'
const local = '127.0.0.1:3344'

interface RequestHeaders {
  [name: string]: string | undefined
}

// Structural doubles for the facade's private server, route, response and connection contracts.
interface TestResponse {
  status?: number
  headers?: Record<string, string>
  body?: string
  writeHead(status: number, headers: Record<string, string>): unknown
  end(body?: string): unknown
}

interface NodeRequest {
  headers: RequestHeaders
}

interface TestRoute {
  handler?: (request: NodeRequest, response: TestResponse, ...args: unknown[]) => unknown
  resource?: (request: Request, ...args: unknown[]) => Response | Promise<Response>
  [key: string]: unknown
}

interface TestConnection {
  allowsRemoteAuthorities?: boolean
  requestRejection?(request: NodeRequest): number | undefined
}

interface FixtureOptions {
  connection?: TestConnection
  host?: string
  logger?: { warn: (...args: unknown[]) => void }
}

function fixture({ connection, host = '127.0.0.1', logger }: FixtureOptions = {}) {
  const routes: TestRoute[] = []
  class Server {
    [key: string]: unknown
    #host = host
    get host() { return this.#host }
    getOrigin() { return `http://${this.#host}:3344` }
    register(route: TestRoute) { assert.equal(this.#host, host); routes.push(route); return () => routes.pop() }
  }
  const server = new Server()
  const facade: Server = authenticatedWebServer({ get: () => connection, logger }, server)
  return { routes, facade, server }
}

// Model the native synchronous admission contract; assertions verify it receives original headers.
function nativeConnection(seen: RequestHeaders[] = []): TestConnection {
  return {
    allowsRemoteAuthorities: true,
    requestRejection(request) {
      seen.push({ ...request.headers })
      const headers = request.headers
      const host = headers.host
      if (host === undefined || ![lan, local].includes(host)
        || (headers.origin && headers.origin !== `http://${headers.host}`)
        || headers['sec-fetch-site'] === 'cross-site') return 403
      if (headers.cookie !== 'authenticated') return 401
    },
  }
}

function response(): TestResponse {
  return {
    writeHead(status, headers) { this.status = status; this.headers = headers },
    end(body) { this.body = body },
  }
}

for (const host of [lan, local]) test(`unauthenticated handler ${host} is rejected before side effects`, () => {
  const { facade, routes } = fixture({ connection: nativeConnection() })
  let called = false
  facade.register({ kind: 'exact', path: '/private', handler() { called = true } })
  const res = response()
  routes[0].handler!({ headers: { host } }, res)
  assert.equal(res.status, 401)
  assert.equal(called, false)
})

test('wrong Origin and cross-site requests are rejected before normalization', () => {
  const { facade, routes } = fixture({ connection: nativeConnection() })
  facade.register({ handler() { assert.fail('private handler reached') } })
  for (const extra of [{ origin: 'http://attacker.test' }, { 'sec-fetch-site': 'cross-site' }]) {
    const res = response()
    routes[0].handler!({ headers: { host: lan, cookie: 'authenticated', ...extra } }, res)
    assert.equal(res.status, 403)
  }
})

test('authenticated LAN handler receives legacy loopback headers and a functioning stream', async () => {
  const seen: RequestHeaders[] = []
  const { facade, routes, server } = fixture({ connection: nativeConnection(seen) })
  const req = Object.assign(Readable.from(['body']), {
    headers: { host: lan, origin: `http://${lan}`, cookie: 'authenticated', 'sec-fetch-site': 'same-origin' },
  })
  facade.register({ handler: async (incoming: NodeRequest) => {
    assert.equal(incoming.headers.host, local)
    assert.equal(incoming.headers.origin, `http://${local}`)
    assert.equal(incoming.headers['sec-fetch-site'], 'same-origin')
    // The facade proxies only headers; the runtime request is still the original Readable.
    let body = ''
    for await (const chunk of incoming as unknown as AsyncIterable<string>) body += chunk
    assert.equal(body, 'body')
  } })
  await routes[0].handler!(req, response())
  assert.equal(seen[0].host, lan)
  assert.equal(seen[0].origin, `http://${lan}`)
  assert.equal(req.headers.host, lan)
  assert.equal(facade.getOrigin(), server.getOrigin())
  assert.equal(server.host, facade.host)
})

test('Fetch resources reject unauthenticated and cross-origin requests and adapt admitted LAN', async () => {
  const seen: RequestHeaders[] = []
  const { facade, routes } = fixture({ connection: nativeConnection(seen) })
  let calls = 0
  facade.register({ resource: (request: Request) => {
    calls++
    assert.equal(request.headers.get('host'), local)
    assert.equal(request.headers.get('origin'), `http://${local}`)
    return new Response('private')
  } })
  for (const host of [lan, local]) {
    const result = await routes[0].resource!(new Request(`http://${host}/private`, { headers: { host } }))
    assert.equal(result.status, 401)
  }
  const wrong = await routes[0].resource!(new Request(`http://${lan}/private`, { headers: { host: lan, cookie: 'authenticated', origin: 'http://attacker.test' } }))
  assert.equal(wrong.status, 403)
  assert.equal(calls, 0)
  const original = new Request(`http://${lan}/private`, { headers: { host: lan, cookie: 'authenticated', origin: `http://${lan}` } })
  assert.equal(await (await routes[0].resource!(original)).text(), 'private')
  assert.equal(original.headers.get('host'), lan)
  assert.equal(seen.at(-1)?.host, lan)
  assert.equal(calls, 1)
})

test('remote listener without native admission fails closed for both route kinds', async () => {
  const { facade, routes } = fixture({ host: '0.0.0.0' })
  facade.register({ handler() { assert.fail('handler reached') }, resource() { assert.fail('resource reached') } })
  const res = response()
  routes[0].handler!({ headers: { host: local } }, res)
  assert.equal(res.status, 503)
  assert.equal((await routes[0].resource!(new Request(`http://${local}`))).status, 503)
})

test('managed LAN marker fails closed before connection service is available', () => {
  const previous = process.env.WORKSTATION_DSH_LAN_AUTHORITY
  try {
    process.env.WORKSTATION_DSH_LAN_AUTHORITY = lan
    const { facade, routes } = fixture()
    facade.register({ handler() { assert.fail('handler reached') } })
    const res = response()
    routes[0].handler!({ headers: { host: local } }, res)
    assert.equal(res.status, 503)
  } finally {
    if (previous === undefined) delete process.env.WORKSTATION_DSH_LAN_AUTHORITY
    else process.env.WORKSTATION_DSH_LAN_AUTHORITY = previous
  }
})

test('private-only desktop behavior retains original requests and route disposer', async () => {
  const { facade, routes } = fixture()
  const request = { headers: { host: local, origin: 'dsh-app://desktop' } }
  const resource = new Request(`http://${local}`)
  const dispose = facade.register({ handler: (incoming: NodeRequest) => assert.equal(incoming, request), resource: (incoming: Request) => {
    assert.equal(incoming, resource)
    return new Response('desktop')
  } })
  routes[0].handler!(request, response())
  assert.equal(await (await routes[0].resource!(resource)).text(), 'desktop')
  dispose()
  assert.equal(routes.length, 0)
})

test('native admission errors fail closed', () => {
  const warnings: unknown[][] = []
  const { facade, routes } = fixture({
    connection: { allowsRemoteAuthorities: true, requestRejection() { throw new Error('sensitive detail') } },
    logger: { warn: (...args) => warnings.push(args) },
  })
  facade.register({ handler() { assert.fail('handler reached') } })
  const res = response()
  routes[0].handler!({ headers: { host: local } }, res)
  assert.equal(res.status, 503)
  assert.deepEqual(warnings, [['private web route authentication failed']])
})

for (const remote of [false, true]) test(`route wrappers forward optional arguments in ${remote ? 'LAN' : 'private'} mode`, async () => {
  const { facade, routes } = fixture({ connection: remote ? nativeConnection() : undefined })
  const extras: unknown[] = [{ signal: 'context' }, 42]
  const res = response()
  facade.register({
    handler: (_request: NodeRequest, incomingResponse: TestResponse, ...args: unknown[]) => {
      assert.equal(incomingResponse, res)
      assert.deepEqual(args, extras)
      assert.equal(args[0], extras[0])
      return 'handled'
    },
    resource: (_request: Request, ...args: unknown[]) => {
      assert.deepEqual(args, extras)
      assert.equal(args[0], extras[0])
      return new Response('resource')
    },
  })
  const headers = { host: remote ? lan : local, cookie: 'authenticated' }
  assert.equal(routes[0].handler!({ headers }, res, ...extras), 'handled')
  assert.equal(await (await routes[0].resource!(new Request(`http://${headers.host}`, { headers }), ...extras)).text(), 'resource')
})
