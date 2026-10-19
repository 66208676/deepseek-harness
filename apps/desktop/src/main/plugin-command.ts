/**
 * Run `dsh plugin --profile <name> add|remove <spec>` after an explicit confirm.
 * Specs are argv elements, not a shell string.
 * @module
 */

import { execFile } from 'node:child_process'
import { NORMAL_PROFILE } from './runtime/harness-runtime'
import { resolveNodeExecutable } from './runtime/node-executable'

export type PluginAction = 'add' | 'remove'

/**
 * Reject empty, flag-like, and multiline specs before they reach pnpm.
 * @param spec - package spec from the shell dialog
 * @returns trimmed spec
 */
export function assertPluginSpec(spec: string): string {
  const trimmed = spec.trim()
  if (trimmed.length === 0 || trimmed.length > 512) {
    throw new Error('Plugin spec is empty or too long.')
  }
  if (/[\r\n\0]/u.test(trimmed) || trimmed.startsWith('-')) {
    throw new Error('Plugin spec must be a package name, not a flag or multiline text.')
  }
  return trimmed
}

/**
 * Build `dsh plugin` argv.
 * @param profile - profile that receives the package
 * @param action - add or remove
 * @param spec - validated package spec
 * @returns arguments after the dsh entry
 */
export function buildPluginArguments(profile: string, action: PluginAction, spec: string): string[] {
  return ['plugin', '--profile', profile, action, spec]
}

export interface PluginCommandRequest {
  dshEntryPath: string
  repoRoot: string
  dshHome: string
  profile?: string
  action: PluginAction
  spec: string
}

export interface PluginCommandResult {
  code: number
  output: string
}

/**
 * Run one plugin add or remove. The caller confirms with the user first.
 * @param request - entry, home, and spec
 * @returns exit code and combined output
 */
export async function runPluginCommand(request: PluginCommandRequest): Promise<PluginCommandResult> {
  const spec = assertPluginSpec(request.spec)
  const profile = request.profile ?? NORMAL_PROFILE
  const node = resolveNodeExecutable()
  const pluginArgs = buildPluginArguments(profile, request.action, spec)
  const nodeArgs = request.dshEntryPath.endsWith('.js')
    ? [request.dshEntryPath, ...pluginArgs]
    : ['--import', 'tsx/esm', request.dshEntryPath, ...pluginArgs]
  const env: NodeJS.ProcessEnv = { ...process.env, DSH_HOME: request.dshHome }
  if (node.runAsNode) env.ELECTRON_RUN_AS_NODE = '1'
  else delete env.ELECTRON_RUN_AS_NODE

  return await new Promise((resolve) => {
    execFile(
      node.executablePath,
      nodeArgs,
      { cwd: request.repoRoot, env, windowsHide: true, timeout: 10 * 60_000 },
      (error, stdout, stderr) => {
        const output = `${stdout ?? ''}${stderr ?? ''}`.slice(-8_000)
        const code = error && 'code' in error && typeof error.code === 'number' ? error.code : error ? 1 : 0
        resolve({ code, output })
      },
    )
  })
}
