/**
 * URL and permission policy for the desktop BrowserWindow.
 * @module
 */

function isHarnessUrl(rawUrl: string): boolean {
  try {
    const url = new URL(rawUrl)
    return (
      url.protocol === 'http:' &&
      (url.hostname === '127.0.0.1' || url.hostname === 'localhost')
    )
  } catch {
    return false
  }
}

/**
 * Whether the renderer may navigate to or open `rawUrl` inside the app.
 * @param rawUrl - candidate navigation target
 * @returns true for loopback Harness, local file, and in-app splash `data:` URLs
 */
export function isTrustedAppUrl(rawUrl: string): boolean {
  try {
    const parsed = new URL(rawUrl)
    if (parsed.protocol === 'file:') return true
    // Main loads a data: splash while Harness boots; `will-navigate` sees that URL.
    if (parsed.protocol === 'data:') return true
  } catch {
    return false
  }
  return isHarnessUrl(rawUrl)
}

/**
 * Whether Chromium may grant a permission request from the main frame.
 * @param permission - Electron permission name
 * @param requestingUrl - requesting page URL
 * @param isMainFrame - whether the request is from the main frame
 * @returns true only for a narrow clipboard/notification allowlist on Harness
 */
export function canGrantWindowPermission(
  permission: string,
  requestingUrl: string | undefined,
  isMainFrame: boolean,
): boolean {
  return (
    (permission === 'clipboard-sanitized-write' || permission === 'notifications') &&
    isMainFrame &&
    requestingUrl !== undefined &&
    isHarnessUrl(requestingUrl)
  )
}
