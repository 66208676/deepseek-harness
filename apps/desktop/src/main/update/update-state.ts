/**
 * Update status transitions for the desktop shell.
 * @module
 */

/** Phases the menu and dialogs display. */
export type UpdatePhase =
  | 'idle'
  | 'unsupported'
  | 'checking'
  | 'available'
  | 'downloading'
  | 'downloaded'
  | 'not-available'
  | 'error'

/** Current update status. */
export interface UpdateStatus {
  phase: UpdatePhase
  currentVersion: string
  manual: boolean
  availableVersion?: string
  percent?: number
  message?: string
}

/** Events applied by {@link reduceUpdateStatus}. */
export type UpdateStateEvent =
  | { type: 'check'; manual: boolean }
  | { type: 'available'; version: string }
  | { type: 'progress'; percent: number }
  | { type: 'downloaded'; version: string }
  | { type: 'not-available' }
  | { type: 'error'; message: string }
  | { type: 'unsupported'; message: string }
  | { type: 'reset' }

/**
 * Initial status for a build that has not checked yet.
 * @param currentVersion - running app version
 * @returns idle status
 */
export function initialUpdateStatus(currentVersion: string): UpdateStatus {
  return { phase: 'idle', currentVersion, manual: false }
}

/**
 * Apply one update event.
 * @param current - previous status
 * @param event - transition
 * @returns next status
 */
export function reduceUpdateStatus(current: UpdateStatus, event: UpdateStateEvent): UpdateStatus {
  const base = { currentVersion: current.currentVersion, manual: current.manual }
  switch (event.type) {
    case 'check':
      return { ...base, phase: 'checking', manual: event.manual }
    case 'available':
      return { ...base, phase: 'available', availableVersion: event.version }
    case 'progress':
      return { ...current, phase: 'downloading', percent: clampPercent(event.percent) }
    case 'downloaded':
      return { ...base, phase: 'downloaded', availableVersion: event.version }
    case 'not-available':
      return { ...base, phase: 'not-available' }
    case 'error':
      return { ...base, phase: 'error', message: event.message }
    case 'unsupported':
      return { ...base, phase: 'unsupported', message: event.message }
    case 'reset':
      return initialUpdateStatus(current.currentVersion)
    default:
      return current
  }
}

function clampPercent(value: number): number {
  if (!Number.isFinite(value)) return 0
  return Math.min(100, Math.max(0, value))
}
