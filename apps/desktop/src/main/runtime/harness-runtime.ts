/**
 * Start and supervise the workspace `dsh web` process for the desktop shell.
 * Topology follows dataelement/dsh-desktop; launch binds this monorepo's source CLI.
 * @module
 */

import { execFile, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { createWriteStream, existsSync, type WriteStream } from 'node:fs'
import { mkdir } from 'node:fs/promises'
import { createServer } from 'node:net'
import { dirname } from 'node:path'
import type { RuntimePhase, RuntimeSnapshot } from '../../shared/contracts'
import { resolveNodeExecutable } from './node-executable'

/** Default preferred loopback port when free. */
export const DEFAULT_HARNESS_PORT = 43129

export interface HarnessRuntimeOptions {
  /** Absolute path to `apps/cli/src/bin.ts` (or built `lib/bin.js`). */
  dshEntryPath: string
  /** Absolute path to the desktop cordis patch YAML. */
  dshPatchPath: string
  /** `DSH_HOME` for profiles, sessions, and settings. */
  dshHome: string
  /** Repository root used as cwd so workspace resolution matches `pnpm dsh`. */
  repoRoot: string
  /** Append-only log file. */
  logPath: string
  preferredPort?: number
  startupTimeoutMs?: number
  onChanged(snapshot: RuntimeSnapshot): void
}

/**
 * Build argv after the Node/tsx launcher for `dsh web`.
 * @param port - loopback listen port
 * @param patchPath - optional desktop patch
 * @returns CLI arguments starting with `web`
 */
export function buildHarnessArguments(port: number, patchPath?: string): string[] {
  return [
    'web',
    ...(patchPath ? ['--patch', patchPath] : []),
    '--no-open',
    '--host',
    '127.0.0.1',
    '--port',
    String(port),
  ]
}

/**
 * Extract the one-time launch token from a `dsh web:` stdout line.
 * @param line - one stdout line
 * @returns token query value, or undefined
 */
export function extractLaunchToken(line: string): string | undefined {
  const match = /\bdsh web:\s*(\S+)/u.exec(line)
  if (!match?.[1]) return undefined
  try {
    const token = new URL(match[1]).searchParams.get('token')
    return token === null || token === '' ? undefined : token
  } catch {
    return undefined
  }
}

/**
 * Extract the announced root URL from a `dsh web:` stdout line.
 * @param line - one stdout line
 * @returns absolute URL string, or undefined
 */
export function extractLaunchUrl(line: string): string | undefined {
  const match = /\bdsh web:\s*(\S+)/u.exec(line)
  return match?.[1]
}

async function reserveLoopbackPort(preferredPort: number): Promise<number> {
  const tryListen = (port: number): Promise<number | undefined> =>
    new Promise((resolve) => {
      const server = createServer()
      server.once('error', () => resolve(undefined))
      server.listen(port, '127.0.0.1', () => {
        const address = server.address()
        server.close(() => {
          resolve(typeof address === 'object' && address ? address.port : port)
        })
      })
    })

  const preferred = await tryListen(preferredPort)
  if (preferred !== undefined) return preferred
  const ephemeral = await tryListen(0)
  if (ephemeral === undefined) {
    throw new Error('Could not reserve a loopback port for Harness')
  }
  return ephemeral
}

async function waitUntilReady(
  baseUrl: string,
  isAlive: () => boolean,
  getToken: () => string | undefined,
  timeoutMs: number,
): Promise<boolean> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (!isAlive()) return false
    const token = getToken()
    if (token) {
      try {
        const response = await fetch(`${baseUrl}/?token=${encodeURIComponent(token)}`, {
          redirect: 'manual',
        })
        if (response.status === 200 || response.status === 302 || response.status === 303) {
          return true
        }
      } catch {
        // Still booting.
      }
    } else {
      try {
        const response = await fetch(baseUrl, { redirect: 'manual' })
        if (response.ok || response.status === 302 || response.status === 303) {
          return true
        }
      } catch {
        // Still booting.
      }
    }
    await new Promise(resolve => setTimeout(resolve, 250))
  }
  return false
}

/**
 * Supervises one Harness child process for the desktop window.
 */
export class HarnessRuntime {
  private child: ChildProcessWithoutNullStreams | undefined
  private phase: RuntimePhase = 'idle'
  private message = 'Harness is not running.'
  private url: string | undefined
  private launchToken: string | undefined
  private logStream: WriteStream | undefined
  private stdoutRemainder = ''

  constructor(private readonly options: HarnessRuntimeOptions) {}

  /**
   * Current runtime snapshot for the UI.
   * @returns phase, message, and optional ready URL/token
   */
  getSnapshot(): RuntimeSnapshot {
    return {
      phase: this.phase,
      message: this.message,
      url: this.url,
      launchToken: this.launchToken,
    }
  }

  /**
   * Start `dsh web` on loopback and wait until the announced URL is healthy.
   * @returns when ready or failed (state is on the snapshot)
   */
  async start(): Promise<void> {
    await this.stop()

    if (!existsSync(this.options.dshEntryPath)) {
      this.setState('failed', `Harness entry was not found: ${this.options.dshEntryPath}`)
      return
    }
    const patchPath = existsSync(this.options.dshPatchPath)
      ? this.options.dshPatchPath
      : undefined
    if (!patchPath) {
      this.writeLog(
        `[desktop] desktop patch missing at ${this.options.dshPatchPath}; launching without --patch`,
      )
    }

    await mkdir(this.options.dshHome, { recursive: true })
    await mkdir(dirname(this.options.logPath), { recursive: true })
    this.logStream ??= createWriteStream(this.options.logPath, { flags: 'a' })

    const preferredPort = this.options.preferredPort ?? DEFAULT_HARNESS_PORT
    const port = await reserveLoopbackPort(preferredPort)
    const baseUrl = `http://127.0.0.1:${port}`
    const harnessArgs = buildHarnessArguments(port, patchPath)
    const node = resolveNodeExecutable()
    const entryIsBuiltJs = this.options.dshEntryPath.endsWith('.js')
    const nodeArgs = entryIsBuiltJs
      ? [this.options.dshEntryPath, ...harnessArgs]
      : ['--import', 'tsx/esm', this.options.dshEntryPath, ...harnessArgs]

    const startupTimeoutMs =
      this.options.startupTimeoutMs ?? (process.platform === 'win32' ? 180_000 : 90_000)

    this.writeLog(`[desktop] starting ${new Date().toISOString()}`)
    this.writeLog(`[desktop] repo ${this.options.repoRoot}`)
    this.writeLog(`[desktop] entry ${this.options.dshEntryPath}`)
    this.writeLog(`[desktop] node ${node.executablePath} runAsNode=${node.runAsNode}`)
    this.writeLog(`[desktop] endpoint ${baseUrl}`)
    this.setState('starting', 'Starting DeepSeek Harness…')

    const env: NodeJS.ProcessEnv = {
      ...process.env,
      DSH_HOME: this.options.dshHome,
      NO_COLOR: '1',
      DSH_TELEMETRY_DISABLED: process.env.DSH_TELEMETRY_DISABLED ?? '1',
    }
    if (node.runAsNode) env.ELECTRON_RUN_AS_NODE = '1'
    else delete env.ELECTRON_RUN_AS_NODE

    let child: ChildProcessWithoutNullStreams
    try {
      child = execFile(node.executablePath, nodeArgs, {
        cwd: this.options.repoRoot,
        env,
        windowsHide: true,
      }) as ChildProcessWithoutNullStreams
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      this.setState('failed', `Harness could not start: ${message}`)
      return
    }
    this.child = child

    child.stdout.on('data', (chunk: Buffer) => {
      if (this.child !== child) return
      this.consumeStdout(chunk.toString('utf8'))
    })
    child.stderr.on('data', (chunk: Buffer) => {
      if (this.child !== child) return
      this.writeLog(chunk.toString('utf8').replace(/\r?\n$/u, ''))
    })
    child.once('error', (error) => {
      this.writeLog(`[node] ${error.stack ?? error.message}`)
      if (this.child !== child) return
      this.child = undefined
      this.setState('failed', `Harness could not start: ${error.message}`)
    })
    child.once('exit', (code, signal) => {
      const detail = signal ? `signal ${signal}` : `code ${code ?? -1}`
      this.writeLog(`[node] Harness process exited (${detail})`)
      if (this.child !== child) return
      this.child = undefined
      this.setState('failed', `Harness stopped unexpectedly (${detail}).`)
    })

    const ready = await waitUntilReady(
      baseUrl,
      () => this.child === child && child.exitCode === null,
      () => this.launchToken,
      startupTimeoutMs,
    )

    if (this.child !== child) return
    if (!ready) {
      await this.stopChild(child)
      this.setState(
        'failed',
        `Harness did not become ready within ${Math.round(startupTimeoutMs / 1000)} seconds.`,
      )
      return
    }

    this.url = this.url ?? baseUrl
    this.writeLog('[desktop] Harness is ready')
    this.setState('ready', 'Harness is ready.')
  }

  /**
   * Stop the Harness child if running.
   */
  async stop(): Promise<void> {
    const child = this.child
    if (!child) {
      this.closeLog()
      if (this.phase !== 'failed') this.setState('idle', 'Harness is not running.')
      return
    }
    this.setState('stopping', 'Stopping Harness…')
    this.child = undefined
    await this.stopChild(child)
    this.closeLog()
    this.url = undefined
    this.launchToken = undefined
    this.setState('idle', 'Harness is not running.')
  }

  private consumeStdout(chunk: string): void {
    const text = this.stdoutRemainder + chunk
    const lines = text.split(/\r?\n/u)
    this.stdoutRemainder = lines.pop() ?? ''
    for (const line of lines) {
      this.writeLog(line)
      const token = extractLaunchToken(line)
      if (token) this.launchToken = token
      const url = extractLaunchUrl(line)
      if (url) this.url = url
    }
  }

  private setState(phase: RuntimePhase, message: string): void {
    this.phase = phase
    this.message = message
    this.options.onChanged(this.getSnapshot())
  }

  private writeLog(line: string): void {
    const stamped = line.startsWith('[') ? line : `[harness] ${line}`
    this.logStream?.write(`${stamped}\n`)
    if (process.env.DSH_DESKTOP_ECHO_LOGS === '1') {
      console.log(stamped)
    }
  }

  private closeLog(): void {
    this.logStream?.end()
    this.logStream = undefined
  }

  private async stopChild(child: ChildProcessWithoutNullStreams): Promise<void> {
    if (child.exitCode !== null) return
    await new Promise<void>((resolve) => {
      const timer = setTimeout(() => {
        if (child.exitCode === null) child.kill('SIGKILL')
        resolve()
      }, 5_000)
      child.once('exit', () => {
        clearTimeout(timer)
        resolve()
      })
      child.kill('SIGTERM')
    })
  }
}
