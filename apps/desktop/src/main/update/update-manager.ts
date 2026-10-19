/**
 * electron-updater wiring. Development launches never contact the feed.
 * @module
 */

import { app, dialog } from 'electron'
import electronUpdater from 'electron-updater'
import {
  AUTO_INSTALL_ON_APP_QUIT,
  supportsAutoUpdates,
  UPDATE_CHECK_INTERVAL_MS,
  UPDATE_GITHUB_OWNER,
  UPDATE_GITHUB_REPO,
  UPDATE_STARTUP_DELAY_MS,
  UPDATE_STARTUP_JITTER_MS,
} from './update-policy'
import {
  readSkippedVersion,
  shouldOfferUpdate,
  skippedVersionPath,
  writeSkippedVersion,
} from './skipped-version'
import { initialUpdateStatus, reduceUpdateStatus, type UpdateStatus } from './update-state'

const { autoUpdater } = electronUpdater

/**
 * Start update checks for a packaged build, or record that dev mode is unsupported.
 * @returns a stop function that clears timers
 */
export function startUpdateManager(): () => void {
  let status: UpdateStatus = initialUpdateStatus(app.getVersion())
  if (!supportsAutoUpdates(app.isPackaged, process.platform)) {
    status = reduceUpdateStatus(status, {
      type: 'unsupported',
      message: 'Updates are available only in a packaged macOS or Windows build of this fork.',
    })
    return () => undefined
  }

  autoUpdater.autoDownload = false
  autoUpdater.autoInstallOnAppQuit = AUTO_INSTALL_ON_APP_QUIT
  autoUpdater.setFeedURL({
    provider: 'github',
    owner: UPDATE_GITHUB_OWNER,
    repo: UPDATE_GITHUB_REPO,
  })

  const skipPath = skippedVersionPath(app.getPath('userData'))

  const offer = (version: string, manual: boolean): void => {
    if (!shouldOfferUpdate(version, readSkippedVersion(skipPath), manual)) return
    dialog
      .showMessageBox({
        type: 'info',
        buttons: ['Download and install', 'Skip this version', 'Later'],
        defaultId: 2,
        cancelId: 2,
        message: `Update ${version} is available`,
        detail: 'The download starts only after you choose Download and install.',
      })
      .then((result) => {
        if (result.response === 0) {
          void autoUpdater.downloadUpdate()
          return
        }
        if (result.response === 1) writeSkippedVersion(skipPath, version)
      })
      .catch((error: unknown) => {
        const message = error instanceof Error ? error.message : String(error)
        status = reduceUpdateStatus(status, { type: 'error', message })
      })
  }

  autoUpdater.on('update-available', (info) => {
    status = reduceUpdateStatus(status, { type: 'available', version: info.version })
    offer(info.version, status.manual)
  })
  autoUpdater.on('update-not-available', () => {
    status = reduceUpdateStatus(status, { type: 'not-available' })
  })
  autoUpdater.on('download-progress', (progress) => {
    status = reduceUpdateStatus(status, { type: 'progress', percent: progress.percent })
  })
  autoUpdater.on('update-downloaded', (info) => {
    status = reduceUpdateStatus(status, { type: 'downloaded', version: info.version })
    dialog
      .showMessageBox({
        type: 'info',
        buttons: ['Restart and install', 'Later'],
        defaultId: 1,
        cancelId: 1,
        message: `Update ${info.version} is ready`,
        detail: 'Installation starts only after you choose Restart and install.',
      })
      .then((result) => {
        if (result.response === 0) autoUpdater.quitAndInstall()
      })
      .catch(() => undefined)
  })
  autoUpdater.on('error', (error) => {
    status = reduceUpdateStatus(status, { type: 'error', message: error.message })
  })

  const check = (manual: boolean): void => {
    status = reduceUpdateStatus(status, { type: 'check', manual })
    void autoUpdater.checkForUpdates().catch((error: unknown) => {
      const message = error instanceof Error ? error.message : String(error)
      status = reduceUpdateStatus(status, { type: 'error', message })
    })
  }

  const delay = UPDATE_STARTUP_DELAY_MS + Math.floor(Math.random() * UPDATE_STARTUP_JITTER_MS)
  const startup = setTimeout(() => check(false), delay)
  const timer = setInterval(() => check(false), UPDATE_CHECK_INTERVAL_MS)

  return () => {
    clearTimeout(startup)
    clearInterval(timer)
  }
}

/**
 * Status text for the manual check menu before a packaged feed exists.
 * @param isPackaged - Electron packaged flag
 * @param platform - host platform
 * @returns user-facing sentence
 */
export function manualUpdateMessage(isPackaged: boolean, platform: NodeJS.Platform): string {
  if (!supportsAutoUpdates(isPackaged, platform)) {
    return 'Updates run only in a packaged macOS or Windows build. This launch will not download anything.'
  }
  return `Checking GitHub releases for ${UPDATE_GITHUB_OWNER}/${UPDATE_GITHUB_REPO}.`
}
