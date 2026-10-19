/**
 * LAN pairing bridge. The phone talks to this process; Harness stays on loopback.
 * Public tunnels are intentionally absent.
 * @module
 */

import { randomBytes, timingSafeEqual } from 'node:crypto'
import { createServer, request as httpRequest, type IncomingMessage, type ServerResponse } from 'node:http'
import type { AddressInfo } from 'node:net'
import { networkInterfaces, type NetworkInterfaceInfo } from 'node:os'

const PAIR_QUERY = 'pair'
const PAIR_TTL_MS = 5 * 60 * 1000
const FAIL_WINDOW_MS = 10 * 60 * 1000
const FAIL_PER_IP = 5
const FAIL_GLOBAL = 20

export interface LanPairing {
  url: string
  token: string
  expiresAt: number
}

interface FailureWindow {
  at: number
  count: number
}

/**
 * First non-internal IPv4 address, for a URL the phone can open.
 * @param interfaces - `os.networkInterfaces()` result
 * @returns address, or undefined when the host has none
 */
export function firstLanIPv4(
  interfaces: NodeJS.Dict<NetworkInterfaceInfo[]> = networkInterfaces(),
): string | undefined {
  for (const entries of Object.values(interfaces)) {
    for (const entry of entries ?? []) {
      if (entry.family === 'IPv4' && !entry.internal) return entry.address
    }
  }
  return undefined
}

/**
 * HTTP reverse proxy that requires a short-lived pairing token.
 * The bridge holds the Harness browser cookie and does not publish the loopback port.
 */
export class LanPairingBridge {
  private server: ReturnType<typeof createServer> | undefined
  private token = ''
  private expiresAt = 0
  private cookie = ''
  private harnessPort = 0
  private failures = new Map<string, FailureWindow>()
  private globalFailures: FailureWindow = { at: 0, count: 0 }

  /**
   * Whether the bridge is accepting connections.
   * @returns true while the server is listening and the token is unexpired
   */
  isRunning(): boolean {
    return this.server !== undefined && Date.now() < this.expiresAt
  }

  /**
   * Open the bridge for one Harness URL that already includes the launch token.
   * @param harnessUrl - ready URL from the desktop runtime
   * @returns LAN URL, pairing token, and expiry
   */
  async start(harnessUrl: string): Promise<LanPairing> {
    await this.stop()
    const target = new URL(harnessUrl)
    this.harnessPort = Number(target.port)
    this.cookie = await exchangeLaunchCookie(target)
    this.token = randomBytes(18).toString('base64url')
    this.expiresAt = Date.now() + PAIR_TTL_MS
    this.failures.clear()
    this.globalFailures = { at: 0, count: 0 }

    const server = createServer((req, res) => {
      this.handle(req, res)
    })
    server.on('upgrade', (req, socket) => {
      if (!this.authorize(req)) {
        socket.destroy()
        return
      }
      this.pipeUpgrade(req, socket)
    })
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject)
      server.listen(0, '0.0.0.0', () => resolve())
    })
    this.server = server
    const address = server.address() as AddressInfo
    const host = firstLanIPv4() ?? '127.0.0.1'
    const url = new URL(`http://${host}:${address.port}/`)
    url.searchParams.set(PAIR_QUERY, this.token)
    return { url: url.toString(), token: this.token, expiresAt: this.expiresAt }
  }

  /** Stop listening. Outstanding phone sessions stop with the server. */
  async stop(): Promise<void> {
    const server = this.server
    this.server = undefined
    this.token = ''
    this.cookie = ''
    if (!server) return
    await new Promise<void>(resolve => server.close(() => resolve()))
  }

  private handle(req: IncomingMessage, res: ServerResponse): void {
    if (!this.authorize(req)) {
      res.writeHead(401, { 'content-type': 'text/plain; charset=utf-8' })
      res.end('pairing required')
      return
    }
    const target = this.forwardPath(req.url ?? '/')
    const headers = forwardHeaders(req, this.harnessPort, this.cookie)
    const upstream = httpRequest(
      {
        hostname: '127.0.0.1',
        port: this.harnessPort,
        method: req.method,
        path: target,
        headers,
      },
      (up) => {
        const responseHeaders = { ...up.headers }
        delete responseHeaders['set-cookie']
        res.writeHead(up.statusCode ?? 502, responseHeaders)
        up.pipe(res)
      },
    )
    upstream.on('error', () => {
      if (!res.headersSent) res.writeHead(502)
      res.end('harness unreachable')
    })
    req.pipe(upstream)
  }

  private pipeUpgrade(req: IncomingMessage, socket: import('node:stream').Duplex): void {
    const headers = forwardHeaders(req, this.harnessPort, this.cookie)
    const upstream = httpRequest({
      hostname: '127.0.0.1',
      port: this.harnessPort,
      method: req.method,
      path: this.forwardPath(req.url ?? '/'),
      headers,
    })
    upstream.on('upgrade', (upRes, upSocket, head) => {
      const lines = [`HTTP/1.1 ${upRes.statusCode ?? 101} ${upRes.statusMessage ?? 'Switching Protocols'}`]
      for (const [key, value] of Object.entries(upRes.headers)) {
        if (value === undefined) continue
        const printed = Array.isArray(value) ? value.join(', ') : value
        lines.push(`${key}: ${printed}`)
      }
      socket.write(`${lines.join('\r\n')}\r\n\r\n`)
      if (head.length > 0) socket.write(head)
      upSocket.pipe(socket)
      socket.pipe(upSocket)
    })
    upstream.on('error', () => socket.destroy())
    upstream.end()
  }

  private authorize(req: IncomingMessage): boolean {
    if (Date.now() >= this.expiresAt) return false
    const remote = req.socket.remoteAddress ?? 'unknown'
    if (this.blocked(remote)) return false
    const presented = readPairToken(req.url ?? '/')
    const ok = presented !== undefined && tokensEqual(presented, this.token)
    if (!ok) this.noteFailure(remote)
    return ok
  }

  private blocked(remote: string): boolean {
    const now = Date.now()
    const ip = this.failures.get(remote)
    if (ip && now - ip.at < FAIL_WINDOW_MS && ip.count >= FAIL_PER_IP) return true
    return now - this.globalFailures.at < FAIL_WINDOW_MS && this.globalFailures.count >= FAIL_GLOBAL
  }

  private noteFailure(remote: string): void {
    const now = Date.now()
    const current = this.failures.get(remote)
    if (!current || now - current.at >= FAIL_WINDOW_MS) this.failures.set(remote, { at: now, count: 1 })
    else current.count += 1
    if (now - this.globalFailures.at >= FAIL_WINDOW_MS) this.globalFailures = { at: now, count: 1 }
    else this.globalFailures.count += 1
  }

  private forwardPath(rawUrl: string): string {
    const url = new URL(rawUrl, 'http://127.0.0.1')
    url.searchParams.delete(PAIR_QUERY)
    return `${url.pathname}${url.search}`
  }
}

/**
 * Build upstream request headers. Drop hop-by-hop proxy fields that Node's
 * IncomingHttpHeaders type does not list as known keys.
 * @param req - phone request
 * @param harnessPort - loopback Harness port
 * @param cookie - session cookie exchanged at pairing
 * @returns headers safe to send to Harness
 */
function forwardHeaders(
  req: IncomingMessage,
  harnessPort: number,
  cookie: string,
): Record<string, string | string[] | undefined> {
  const headers: Record<string, string | string[] | undefined> = { ...req.headers }
  headers.host = `127.0.0.1:${harnessPort}`
  headers.cookie = cookie
  delete headers['proxy-connection']
  delete headers.connection
  return headers
}

function readPairToken(rawUrl: string): string | undefined {
  try {
    const token = new URL(rawUrl, 'http://127.0.0.1').searchParams.get(PAIR_QUERY)
    return token === null || token === '' ? undefined : token
  } catch {
    return undefined
  }
}

function tokensEqual(presented: string, expected: string): boolean {
  const left = Buffer.from(presented)
  const right = Buffer.from(expected)
  if (left.length !== right.length) return false
  return timingSafeEqual(left, right)
}

function exchangeLaunchCookie(target: URL): Promise<string> {
  return new Promise((resolve, reject) => {
    const req = httpRequest(
      {
        hostname: '127.0.0.1',
        port: target.port,
        path: `/${target.search}`,
        method: 'GET',
        headers: { host: target.host },
      },
      (res) => {
        const raw = res.headers['set-cookie']
        const first = Array.isArray(raw) ? raw[0] : raw
        res.resume()
        if (!first) {
          reject(new Error('Harness did not issue a browser session cookie.'))
          return
        }
        resolve(first.split(';', 1)[0] ?? first)
      },
    )
    req.on('error', reject)
    req.end()
  })
}
