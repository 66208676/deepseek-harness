/**
 * Isolated Safe Mode profile. The normal `web` profile and its plugins stay on disk.
 * @module
 */

import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

/** Profile directory name under `$DSH_HOME/profiles`. */
export const SAFE_MODE_PROFILE = 'desktop-safe-mode'

/** Official bundles only. Third-party profile dependencies are not copied. */
export const SAFE_MODE_BUNDLES = ['@deepseek-ai/dsh-base', '@deepseek-ai/dsh-web-app'] as const

const SAFE_MODE_PATCH = `# Managed by DSH Desktop Safe Mode.
# Third-party bundles and the normal web profile patch layer are omitted.
[]
`

const SAFE_MODE_WORKSPACE = `packages:
  - .

nodeLinker: hoisted
autoInstallPeers: false
`

/**
 * Whether this process was started with `--safe-mode`.
 * @param argv - process arguments
 * @returns true when the flag is present
 */
export function launchedInSafeMode(argv: readonly string[]): boolean {
  return argv.includes('--safe-mode')
}

/**
 * Create or refresh the Safe Mode profile manifest.
 * Rewrites only the three managed files in the safe profile directory.
 * Does not delete or edit `profiles/web`.
 * @param dshHome - Harness home
 * @returns absolute profile directory
 */
export async function ensureSafeModeProfile(dshHome: string): Promise<string> {
  const directory = join(dshHome, 'profiles', SAFE_MODE_PROFILE)
  await mkdir(directory, { recursive: true })
  const manifest = `${JSON.stringify(
    {
      name: 'dsh-profile-desktop-safe-mode',
      private: true,
      dependencies: {},
      dsh: { profile: { bundles: [...SAFE_MODE_BUNDLES] } },
    },
    null,
    2,
  )}\n`
  await Promise.all([
    writeIfChanged(join(directory, 'package.json'), manifest),
    writeIfChanged(join(directory, 'cordis.patch.yml'), SAFE_MODE_PATCH),
    writeIfChanged(join(directory, 'pnpm-workspace.yaml'), SAFE_MODE_WORKSPACE),
  ])
  return directory
}

async function writeIfChanged(path: string, content: string): Promise<void> {
  try {
    if ((await readFile(path, 'utf8')) === content) return
  } catch {
    // Missing files are created below.
  }
  await writeFile(path, content, 'utf8')
}
