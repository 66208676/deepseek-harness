/**
 * Loopback control plane for Cordis plugins that need Electron to restart Harness.
 * @module
 */

import { createServer, type Server } from 'node:http'

export interface DesktopControlServer {
  /** Base URL such as `http://127.0.0.1:51234`. */
  url: string
  close(): Promise<void>
}

/**
 * Start a loopback-only HTTP server. POST /restart invokes `onRestart`.
 * @param onRestart - Electron-owned restart callback
 * @returns server handle with URL
 */
export async function startDesktopControlServer(
  onRestart: () => void | Promise<void>,
): Promise<DesktopControlServer> {
  const server: Server = createServer((req, res) => {
    if (req.method === 'POST' && req.url === '/restart') {
      res.writeHead(202, { 'content-type': 'application/json' })
      res.end('{"ok":true}')
      void Promise.resolve(onRestart()).catch((error: unknown) => {
        console.error('[desktop-control] restart failed:', error)
      })
      return
    }
    res.writeHead(404)
    res.end()
  })

  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => resolve())
  })
  const address = server.address()
  if (!address || typeof address === 'string') {
    throw new Error('desktop control server did not bind a TCP port')
  }
  return {
    url: `http://127.0.0.1:${address.port}`,
    close: () =>
      new Promise<void>((resolve) => {
        server.close(() => resolve())
      }),
  }
}
