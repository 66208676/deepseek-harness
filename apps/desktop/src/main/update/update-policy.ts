/**
 * When the desktop shell may check for updates.
 * The feed is this fork's GitHub Releases, never another product's update host.
 * @module
 */

/** Hours between automatic checks. */
export const UPDATE_CHECK_INTERVAL_MS = 6 * 60 * 60 * 1_000

/** Delay after launch before the first automatic check. */
export const UPDATE_STARTUP_DELAY_MS = 15_000

/** Extra random delay so clients do not hit the feed together. */
export const UPDATE_STARTUP_JITTER_MS = 15_000

/** Installation waits for an explicit user action. */
export const AUTO_INSTALL_ON_APP_QUIT = false

/** GitHub owner that publishes this fork. */
export const UPDATE_GITHUB_OWNER = '66208676'

/** GitHub repository that publishes this fork. */
export const UPDATE_GITHUB_REPO = 'deepseek-harness'

/**
 * Packaged macOS and Windows builds can install updates. Development launches cannot.
 * @param isPackaged - Electron `app.isPackaged`
 * @param platform - `process.platform`
 * @returns whether auto-update is available
 */
export function supportsAutoUpdates(isPackaged: boolean, platform: NodeJS.Platform): boolean {
  return isPackaged && (platform === 'darwin' || platform === 'win32')
}

/**
 * Whether a resume from sleep should check again.
 * @param lastCheckedAt - epoch ms of the previous check
 * @param now - epoch ms
 * @returns true when the interval has elapsed
 */
export function shouldCheckAfterResume(lastCheckedAt: number, now = Date.now()): boolean {
  return now - lastCheckedAt >= UPDATE_CHECK_INTERVAL_MS
}
