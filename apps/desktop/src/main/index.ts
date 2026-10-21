/**
 * Electron main entry: single-instance desktop shell around workspace `dsh web`.
 * @module
 */

import { app, BrowserWindow, Menu, dialog } from 'electron'
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import type { RuntimeSnapshot } from '../shared/contracts'
import { resolvePptOfficePatch, writePptOfficeEnabled } from './optional-features'
import {
  resolveAppIconPath,
  resolveDesktopPackageRoot,
  resolveDesktopPatchPath,
  resolveDshHome,
  resolveDshSourceEntry,
  resolveHarnessLogPath,
  resolveLaunchRoot,
  resolveRepoRoot,
} from './paths'
import { startDesktopControlServer } from './control-server'
import { LanPairingBridge } from './phone/lan-bridge'
import { runPluginCommand, type PluginAction } from './plugin-command'
import { HarnessRuntime, NORMAL_PROFILE } from './runtime/harness-runtime'
import { SAFE_MODE_PROFILE, ensureSafeModeProfile, launchedInSafeMode } from './safe-mode'
import { secureWindow } from './security'
import { promptShellText } from './shell-prompt'
import { manualUpdateMessage, startUpdateManager } from './update/update-manager'

const isDev = !app.isPackaged

// Keep development and packaged builds from sharing one userData tree.
if (isDev) {
  const base = app.getPath('userData')
  app.setPath('userData', `${base}-dev`)
}

const gotLock = app.requestSingleInstanceLock()
if (!gotLock) {
  app.quit()
} else {
  void boot()
}

async function boot(): Promise<void> {
  await app.whenReady()

  const repoRoot = resolveRepoRoot()
  const dshHome = resolveDshHome()
  const launchRoot = resolveLaunchRoot()
  const desktopRoot = resolveDesktopPackageRoot()
  mkdirSync(dshHome, { recursive: true })
  mkdirSync(launchRoot, { recursive: true })

  const safeAtLaunch = launchedInSafeMode(process.argv)
  if (safeAtLaunch) await ensureSafeModeProfile(dshHome)

  let mainWindow: BrowserWindow | undefined
  let loadedHarnessUrl: string | undefined
  let restartingHarness = false
  const phone = new LanPairingBridge()
  const stopUpdates = startUpdateManager()

  const control = await startDesktopControlServer(() => {
    void restartHarnessInShell('plugin')
  })

  const runtime = new HarnessRuntime({
    dshEntryPath: resolveDshSourceEntry(repoRoot),
    patchPaths: currentPatchPaths(),
    profile: safeAtLaunch ? SAFE_MODE_PROFILE : NORMAL_PROFILE,
    dshHome,
    repoRoot,
    logPath: resolveHarnessLogPath(),
    childEnv: {
      DSH_SURFACE: 'desktop',
      DSH_DESKTOP_CONTROL_URL: control.url,
      // Source launch has no resources/app/@deepseek-ai tree. dsh-purge's desktop
      // locator accepts DSH_BASE only when it sits inside DSH_DESKTOP_INSTALL.
      DSH_BASE: join(repoRoot, 'node_modules', '.pnpm', 'node_modules', '@deepseek-ai'),
      DSH_DESKTOP_INSTALL: repoRoot,
    },
    onChanged: (snapshot) => {
      void onRuntimeChanged(snapshot)
    },
    onUnexpectedExit: () => {
      // dsh-purge's web restart path may have spawned a browser; reclaim Harness.
      void restartHarnessInShell('unexpected-exit')
    },
  })

  function currentPatchPaths(): string[] {
    const paths = [resolveDesktopPatchPath()]
    const optional = resolvePptOfficePatch(
      desktopRoot,
      app.getPath('userData'),
      join(app.getPath('userData'), 'optional-ppt.patch.yml'),
    )
    if (optional.blockedReason) {
      dialog.showErrorBox('PPT/Office', blockMessage(optional.blockedReason))
    }
    if (optional.path) paths.push(optional.path)
    return paths
  }

  function createWindow(): BrowserWindow {
    const icon = resolveAppIconPath(desktopRoot)
    const window = new BrowserWindow({
      width: 1280,
      height: 840,
      show: false,
      ...(icon ? { icon } : {}),
      webPreferences: {
        preload: join(__dirname, '../preload/index.cjs'),
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
        webviewTag: false,
      },
    })
    secureWindow(window)
    window.once('ready-to-show', () => window.show())
    window.on('closed', () => {
      if (mainWindow === window) mainWindow = undefined
    })
    return window
  }

  async function showSplash(message: string): Promise<void> {
    const window = mainWindow ?? createWindow()
    mainWindow = window
    loadedHarnessUrl = undefined
    const html = buildSplashHtml(message)
    await window.loadURL(`data:text/html;charset=UTF-8,${encodeURIComponent(html)}`)
  }

  async function onRuntimeChanged(snapshot: RuntimeSnapshot): Promise<void> {
    if (!mainWindow) mainWindow = createWindow()

    if (snapshot.phase === 'ready' && snapshot.url) {
      if (loadedHarnessUrl === snapshot.url) return
      loadedHarnessUrl = snapshot.url
      await mainWindow.loadURL(snapshot.url)
      return
    }

    if (snapshot.phase === 'failed') {
      await showSplash(snapshot.message)
      const detail = [
        snapshot.message,
        '',
        `Log: ${resolveHarnessLogPath()}`,
        `DSH_HOME: ${dshHome}`,
        `Profile: ${runtime.getProfile()}`,
      ].join('\n')
      dialog.showErrorBox('DSH Desktop', detail)
      return
    }

    if (snapshot.phase === 'starting' || snapshot.phase === 'stopping') {
      await showSplash(snapshot.message)
    }
  }

  async function restartHarnessInShell(reason: string): Promise<void> {
    if (restartingHarness) return
    restartingHarness = true
    try {
      await phone.stop()
      await showSplash(`Restarting DeepSeek Harness (${reason})…`)
      runtime.setPatchPaths(currentPatchPaths())
      await runtime.start()
    } finally {
      restartingHarness = false
    }
  }

  async function restartIn(profile: string): Promise<void> {
    if (profile === SAFE_MODE_PROFILE) await ensureSafeModeProfile(dshHome)
    await phone.stop()
    runtime.setProfile(profile)
    runtime.setPatchPaths(currentPatchPaths())
    await runtime.start()
  }

  async function managePlugin(action: PluginAction): Promise<void> {
    const spec = await promptShellText(
      action === 'add' ? 'Install plugin' : 'Remove plugin',
      'Package spec (name, name@version, or file: path)',
    )
    if (spec === undefined || spec.trim() === '') return
    const profile = runtime.getProfile() === SAFE_MODE_PROFILE ? NORMAL_PROFILE : runtime.getProfile()
    const confirm = await dialog.showMessageBox({
      type: 'warning',
      buttons: [action === 'add' ? 'Install' : 'Remove', 'Cancel'],
      defaultId: 1,
      cancelId: 1,
      message: `${action === 'add' ? 'Install' : 'Remove'} this plugin in profile ${profile}?`,
      detail: spec.trim(),
    })
    if (confirm.response !== 0) return
    const result = await runPluginCommand({
      dshEntryPath: resolveDshSourceEntry(repoRoot),
      repoRoot,
      dshHome,
      profile,
      action,
      spec,
    })
    if (result.code !== 0) {
      dialog.showErrorBox('Plugin', result.output || `dsh plugin exited ${result.code}`)
      return
    }
    await restartIn(runtime.getProfile())
  }

  Menu.setApplicationMenu(
    Menu.buildFromTemplate([
      {
        label: 'Harness',
        submenu: [
          { label: 'Restart Harness', click: () => void restartIn(runtime.getProfile()) },
          { label: 'Restart in Safe Mode', click: () => void restartIn(SAFE_MODE_PROFILE) },
          { label: 'Return to Normal Profile', click: () => void restartIn(NORMAL_PROFILE) },
          { type: 'separator' },
          { label: 'Install Plugin…', click: () => void managePlugin('add') },
          { label: 'Remove Plugin…', click: () => void managePlugin('remove') },
          { type: 'separator' },
          {
            label: 'Connect Phone…',
            click: () => {
              const ready = runtime.getReadyUrl()
              if (!ready) {
                dialog.showErrorBox('Phone', 'Harness is not ready yet.')
                return
              }
              void phone.start(ready).then(
                (pairing) => {
                  void dialog.showMessageBox({
                    type: 'info',
                    message: 'Phone pairing',
                    detail: [
                      pairing.url,
                      '',
                      `Expires ${new Date(pairing.expiresAt).toLocaleString()}`,
                      'The phone reaches this shell, not the Harness port.',
                      'Choose Disconnect Phone to invalidate the session.',
                    ].join('\n'),
                  })
                },
                (error: unknown) => {
                  dialog.showErrorBox('Phone', error instanceof Error ? error.message : String(error))
                },
              )
            },
          },
          { label: 'Disconnect Phone', click: () => void phone.stop() },
          { type: 'separator' },
          {
            label: 'Enable PPT/Office…',
            click: () => {
              void dialog
                .showMessageBox({
                  type: 'warning',
                  buttons: ['Enable', 'Cancel'],
                  defaultId: 1,
                  cancelId: 1,
                  message: 'Enable optional PPT/Office on the next normal launch?',
                  detail:
                    'The composer overlay is written only when apps/desktop/optional/ppt/LICENSE-REVIEWED and package.json both exist.',
                })
                .then(async (result) => {
                  if (result.response !== 0) return
                  writePptOfficeEnabled(app.getPath('userData'), true)
                  await restartIn(NORMAL_PROFILE)
                })
            },
          },
          {
            label: 'Disable PPT/Office',
            click: () => {
              writePptOfficeEnabled(app.getPath('userData'), false)
              void restartIn(NORMAL_PROFILE)
            },
          },
          { type: 'separator' },
          {
            label: 'Check for Updates…',
            click: () => {
              dialog.showMessageBox({
                type: 'info',
                message: 'Updates',
                detail: manualUpdateMessage(app.isPackaged, process.platform),
              })
            },
          },
          { label: 'Reload Window', click: () => mainWindow?.reload() },
          { type: 'separator' },
          { role: 'quit' },
        ],
      },
      { role: 'editMenu' },
      { role: 'viewMenu' },
      { role: 'windowMenu' },
    ]),
  )

  app.on('second-instance', () => {
    if (!mainWindow) return
    if (mainWindow.isMinimized()) mainWindow.restore()
    mainWindow.focus()
  })

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      mainWindow = createWindow()
      void showSplash('Starting DeepSeek Harness…')
      void runtime.start()
    }
  })

  app.on('before-quit', () => {
    stopUpdates()
    void phone.stop()
    void runtime.stop()
    void control.close()
  })

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit()
  })

  mainWindow = createWindow()
  await showSplash('Starting DeepSeek Harness…')
  await runtime.start()
}

function blockMessage(reason: 'license-review-required' | 'packages-not-vendored'): string {
  if (reason === 'license-review-required') {
    return 'PPT/Office stays off until apps/desktop/optional/ppt/LICENSE-REVIEWED exists. The normal profile was not given a composer patch.'
  }
  return 'PPT/Office packages are not vendored. The normal profile was not given a composer patch.'
}

function buildSplashHtml(message: string): string {
  const safe = message
    .replace(/&/gu, '&amp;')
    .replace(/</gu, '&lt;')
    .replace(/>/gu, '&gt;')
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<title>DSH Desktop</title>
<style>
  html, body { height: 100%; margin: 0; font-family: Segoe UI, system-ui, sans-serif; background: #111; color: #eee; }
  main { min-height: 100%; display: grid; place-content: center; gap: 12px; text-align: center; padding: 24px; }
  h1 { font-size: 20px; font-weight: 600; margin: 0; }
  p { margin: 0; max-width: 40rem; line-height: 1.5; color: #bbb; white-space: pre-wrap; }
</style>
</head>
<body>
<main>
  <h1>DSH Desktop</h1>
  <p>${safe}</p>
</main>
</body>
</html>`
}
