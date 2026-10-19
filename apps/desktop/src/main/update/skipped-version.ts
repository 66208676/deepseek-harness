/**
 * Remember one skipped update version across restarts.
 * @module
 */

import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

/**
 * Path of the skip record under Electron userData.
 * @param userDataPath - Electron userData directory
 * @returns absolute JSON path
 */
export function skippedVersionPath(userDataPath: string): string {
  return join(userDataPath, 'update-skip.json')
}

/**
 * Whether an available version should be shown.
 * A manual check ignores the skip.
 * @param version - available version
 * @param skippedVersion - stored skip, if any
 * @param manual - user asked to check
 * @returns true when the shell should offer the update
 */
export function shouldOfferUpdate(
  version: string,
  skippedVersion: string | undefined,
  manual: boolean,
): boolean {
  return manual || version !== skippedVersion
}

/**
 * Read the skipped version. Invalid files count as no skip.
 * @param path - JSON file
 * @returns version string, or undefined
 */
export function readSkippedVersion(path: string): string | undefined {
  try {
    const value = JSON.parse(readFileSync(path, 'utf8')) as { version?: unknown }
    return typeof value.version === 'string' && value.version ? value.version : undefined
  } catch {
    return undefined
  }
}

/**
 * Persist the version the user chose to skip.
 * @param path - JSON file
 * @param version - version to stay silent about
 */
export function writeSkippedVersion(path: string, version: string): void {
  writeFileSync(path, `${JSON.stringify({ version })}\n`, 'utf8')
}
