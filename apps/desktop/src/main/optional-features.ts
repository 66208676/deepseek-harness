/**
 * PPT and Office stay out of the default desktop patch until a license review
 * marker and vendored package manifest both exist.
 * @module
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'

/** File that records a completed license review. It is not created by the shell. */
export const PPT_REVIEW_MARKER = 'optional/ppt/LICENSE-REVIEWED'

/** Vendored package manifest required before a composer row can be written. */
export const PPT_PACKAGE_MANIFEST = 'optional/ppt/package.json'

const ENABLED_FILE = 'optional-features.json'

export type OptionalBlockReason = 'license-review-required' | 'packages-not-vendored'

export interface OptionalPatchDecision {
  /** Absolute patch path when the feature may load. */
  path?: string
  /** Why the patch was not written. */
  blockedReason?: OptionalBlockReason
}

/**
 * User opt-in stored beside Electron userData. Missing file means off.
 * @param userDataPath - Electron userData
 * @returns whether the user asked for PPT/Office
 */
export function readPptOfficeEnabled(userDataPath: string): boolean {
  try {
    const value = JSON.parse(readFileSync(join(userDataPath, ENABLED_FILE), 'utf8')) as {
      pptOffice?: unknown
    }
    return value.pptOffice === true
  } catch {
    return false
  }
}

/**
 * Record the user's opt-in. This does not vendor packages or skip the review marker.
 * @param userDataPath - Electron userData
 * @param enabled - requested state
 */
export function writePptOfficeEnabled(userDataPath: string, enabled: boolean): void {
  const path = join(userDataPath, ENABLED_FILE)
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, `${JSON.stringify({ pptOffice: enabled })}\n`, 'utf8')
}

/**
 * Composer patch text. Present only when review and the package manifest exist.
 * @returns YAML overlay, or undefined
 */
export function pptOfficePatchText(): string {
  return `# Optional PPT composer. Written only after license review and a vendored package.
- insert:
    - id: dsh-ppt-composer
      name: dsh-ppt-composer
`
}

/**
 * Decide whether the normal profile may receive the PPT/Office overlay.
 * @param desktopRoot - `apps/desktop` directory
 * @param userDataPath - Electron userData
 * @param outputPath - where a permitted overlay is written
 * @returns path or a block reason
 */
export function resolvePptOfficePatch(
  desktopRoot: string,
  userDataPath: string,
  outputPath: string,
): OptionalPatchDecision {
  if (!readPptOfficeEnabled(userDataPath)) return {}
  if (!existsSync(join(desktopRoot, PPT_REVIEW_MARKER))) {
    return { blockedReason: 'license-review-required' }
  }
  if (!existsSync(join(desktopRoot, PPT_PACKAGE_MANIFEST))) {
    return { blockedReason: 'packages-not-vendored' }
  }
  mkdirSync(dirname(outputPath), { recursive: true })
  writeFileSync(outputPath, pptOfficePatchText(), 'utf8')
  return { path: outputPath }
}
