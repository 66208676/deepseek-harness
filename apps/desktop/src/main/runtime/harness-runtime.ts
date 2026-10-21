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

/** Shipped web profile name. The `web` subcommand is this profile. */
export const NORMAL_PROFILE = 'web'

export interface HarnessRuntimeOptions {
  /** Absolute path to `apps/cli/src/bin.ts` (or built `lib/bin.js`). */
  dshEntryPath: string
  /** Cordis overlay files passed as repeatable `--patch` (normal profile only). */
  patchPaths?: readonly string[]
  /** Profile under `DSH_HOME/profiles`. Defaults to {@link NORMAL_PROFILE}. */
  profile?: string
  /** `DSH_HOME` for profiles, sessions, and settings. */
  dshHome: string
  /** Repository root used as cwd so workspace resolution matches `pnpm dsh`. */
  repoRoot: string
  /** Append-only log file. */
  logPath: string
  /**
   * Extra environment for the Harness child (desktop control URL, surface, …).
   * Merged over the process env; does not override `DSH_HOME`.
   */
  childEnv?: NodeJS.ProcessEnv
  preferredPort?: number
  startupTimeoutMs?: number
  onChanged(snapshot: RuntimeSnapshot): void
  /**
   * Called when the Harness child exits while the shell still expected it to
   * stay up (for example after dsh-purge schedules an external web restart).
   */
  onUnexpectedExit?: (detail: { code: number | null; signal: NodeJS.Signals | null }) => void
}

/**
 * Build argv after the Node/tsx launcher for a web-capable profile.
 * The normal profile uses the `web` alias. Any other profile uses `--profile`,
 * and launcher-owned flags stay before the app flags (`--no-open`, `--host`, `--port`).
 * @param port - loopback listen port
 * @param patchPaths - overlay files, in order
 * @param profile - profile name
 * @returns CLI arguments
 */
export function buildHarnessArguments(
  port: number,
  patchPaths: readonly string[] = [],
  profile: string = NORMAL_PROFILE,
): string[] {
  const patches = patchPaths.flatMap(patchPath => ['--patch', patchPath])
  const appFlags = ['--no-open', '--host', '127.0.0.1', '--port', String(port)]
  if (profile === NORMAL_PROFILE) return ['web', ...patches, ...appFlags]
  return ['--profile', profile, ...patches, ...appFlags]
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
  private profile: string
  private patchPaths: readonly string[]

  constructor(private readonly options: HarnessRuntimeOptions) {
    this.profile = options.profile ?? NORMAL_PROFILE
    this.patchPaths = options.patchPaths ?? []
  }

  /**
   * Overlay files for the next normal-profile start.
   * @param patchPaths - absolute patch files
   */
  setPatchPaths(patchPaths: readonly string[]): void {
    this.patchPaths = patchPaths
  }

  /**
   * Profile the next {@link start} boots.
   * @returns profile name
   */
  getProfile(): string {
    return this.profile
  }

  /**
   * Select the profile used by the next start. Does not restart by itself.
   * @param profile - profile directory name under `DSH_HOME/profiles`
   */
  setProfile(profile: string): void {
    this.profile = profile
  }

  /**
   * Announced Harness URL, including the launch token when present.
   * @returns absolute URL, or undefined before the ready line
   */
  getReadyUrl(): string | undefined {
    return this.url
  }

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
    const patchPaths = this.patchPaths.filter(patchPath => existsSync(patchPath))
    const skipped = this.patchPaths.filter(patchPath => !existsSync(patchPath))
    for (const missing of skipped) {
      this.writeLog(`[desktop] patch missing at ${missing}; skipping`)
    }

    await mkdir(this.options.dshHome, { recursive: true })
    await mkdir(dirname(this.options.logPath), { recursive: true })
    this.logStream ??= createWriteStream(this.options.logPath, { flags: 'a' })

    const preferredPort = this.options.preferredPort ?? DEFAULT_HARNESS_PORT
    const port = await reserveLoopbackPort(preferredPort)
    const baseUrl = `http://127.0.0.1:${port}`
    const activePatches = this.profile === NORMAL_PROFILE ? patchPaths : []
    const harnessArgs = buildHarnessArguments(port, activePatches, this.profile)
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
    this.writeLog(`[desktop] profile ${this.profile}`)
    this.writeLog(`[desktop] endpoint ${baseUrl}`)
    this.setState('starting', `Starting DeepSeek Harness (${this.profile})…`)

    const env: NodeJS.ProcessEnv = {
      ...process.env,
      ...this.options.childEnv,
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
      const wasReady = this.phase === 'ready'
      this.setState('failed', `Harness stopped unexpectedly (${detail}).`)
      if (wasReady) this.options.onUnexpectedExit?.({ code, signal })
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
