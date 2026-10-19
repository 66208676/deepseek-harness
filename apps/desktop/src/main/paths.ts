/**
 * Resolve monorepo roots and desktop resource paths from the Electron main process.
 * @module
 */

import { app } from 'electron'
import { existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const moduleDirectory = dirname(fileURLToPath(import.meta.url))

/**
 * Absolute path to the deepseek-harness repository root.
 * @returns repo root containing `apps/cli` and `pnpm-workspace.yaml`
 */
export function resolveRepoRoot(): string {
  // electron-vite emits main to apps/desktop/out/main → four hops to the repo.
  // Source under src/main is three hops to apps/desktop and four to the repo.
  const candidates = [
    join(moduleDirectory, '../../../..'),
    join(moduleDirectory, '../../../../..'),
    process.cwd(),
  ]
  for (const candidate of candidates) {
    if (
      existsSync(join(candidate, 'pnpm-workspace.yaml')) &&
      existsSync(join(candidate, 'apps/cli/src/bin.ts'))
    ) {
      return candidate
    }
  }
  throw new Error(
    `Could not resolve deepseek-harness repo root from ${moduleDirectory} (cwd=${process.cwd()})`,
  )
}

/**
 * Absolute path to the desktop package root (`apps/desktop`).
 * @returns package directory that owns `patches/` and `package.json`
 */
export function resolveDesktopPackageRoot(): string {
  const repoRoot = resolveRepoRoot()
  return join(repoRoot, 'apps/desktop')
}

/**
 * Source-launch entry for `dsh` (`apps/cli/src/bin.ts`).
 * @param repoRoot - repository root
 * @returns absolute path to the TypeScript CLI entry
 */
export function resolveDshSourceEntry(repoRoot: string = resolveRepoRoot()): string {
  return join(repoRoot, 'apps/cli/src/bin.ts')
}

/**
 * Desktop cordis patch applied on top of the web profile.
 * @param desktopRoot - `apps/desktop` directory
 * @returns absolute path to `patches/desktop.patch.yml`
 */
export function resolveDesktopPatchPath(
  desktopRoot: string = resolveDesktopPackageRoot(),
): string {
  return join(desktopRoot, 'patches/desktop.patch.yml')
}

/**
 * Per-user Harness home under Electron `userData`.
 * @returns absolute `DSH_HOME` directory
 */
export function resolveDshHome(): string {
  return join(app.getPath('userData'), 'harness')
}

/**
 * Neutral working directory for the Harness child (not the install tree).
 * @returns absolute launch-root directory
 */
export function resolveLaunchRoot(): string {
  return join(app.getPath('userData'), 'launch-root')
}

/**
 * Append-only desktop + Harness log path.
 * @returns absolute log file path
 */
export function resolveHarnessLogPath(): string {
  return join(app.getPath('logs'), 'harness.log')
}
