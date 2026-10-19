/**
 * Resolve a Node executable that can run the workspace `dsh` source entry.
 * @module
 */

import { execFileSync } from 'node:child_process'
import { existsSync } from 'node:fs'

export interface ResolvedNodeExecutable {
  /** Absolute path to the Node (or Electron-as-Node) binary. */
  executablePath: string
  /** Whether the child must receive `ELECTRON_RUN_AS_NODE=1`. */
  runAsNode: boolean
}

/**
 * Prefer a real Node binary so `tsx` and workspace resolution behave like `pnpm dsh`.
 * Fall back to Electron with `ELECTRON_RUN_AS_NODE` when no system Node is found.
 * @returns executable path and whether Electron-as-Node mode is required
 */
export function resolveNodeExecutable(): ResolvedNodeExecutable {
  const npmNode = process.env.npm_node_execpath
  if (npmNode && existsSync(npmNode)) {
    return { executablePath: npmNode, runAsNode: false }
  }

  if (process.versions.electron === undefined) {
    return { executablePath: process.execPath, runAsNode: false }
  }

  try {
    const which = process.platform === 'win32' ? 'where.exe' : 'which'
    const output = execFileSync(which, ['node'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
      windowsHide: true,
    })
    const first = output
      .split(/\r?\n/u)
      .map(line => line.trim())
      .find(line => line.length > 0 && existsSync(line))
    if (first) return { executablePath: first, runAsNode: false }
  } catch {
    // Fall through to Electron-as-Node.
  }

  return { executablePath: process.execPath, runAsNode: true }
}
