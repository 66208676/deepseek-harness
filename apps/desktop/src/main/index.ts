/**
 * Electron main entry: single-instance desktop shell around workspace `dsh web`.
 * @module
 */

import { app, BrowserWindow, Menu, dialog } from 'electron'
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import type { RuntimeSnapshot } from '../shared/contracts'
import {
  resolveDesktopPatchPath,
  resolveDshHome,
  resolveDshSourceEntry,
  resolveHarnessLogPath,
  resolveLaunchRoot,
  resolveRepoRoot,
} from './paths'
import { HarnessRuntime } from './runtime/harness-runtime'
import { secureWindow } from './security'

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
  mkdirSync(dshHome, { recursive: true })
  mkdirSync(launchRoot, { recursive: true })

  let mainWindow: BrowserWindow | undefined
  let loadedHarnessUrl: string | undefined

  const runtime = new HarnessRuntime({
    dshEntryPath: resolveDshSourceEntry(repoRoot),
    dshPatchPath: resolveDesktopPatchPath(),
    dshHome,
    repoRoot,
    logPath: resolveHarnessLogPath(),
    onChanged: (snapshot) => {
      void onRuntimeChanged(snapshot)
    },
  })

  function createWindow(): BrowserWindow {
    const window = new BrowserWindow({
      width: 1280,
      height: 840,
      show: false,
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
      ].join('\n')
      dialog.showErrorBox('DSH Desktop', detail)
      return
    }

    if (snapshot.phase === 'starting' || snapshot.phase === 'stopping') {
      await showSplash(snapshot.message)
    }
  }

  Menu.setApplicationMenu(
    Menu.buildFromTemplate([
      {
        label: 'Harness',
        submenu: [
          {
            label: 'Restart Harness',
            click: () => {
              void runtime.start()
            },
          },
          {
            label: 'Reload Window',
            click: () => {
              mainWindow?.reload()
            },
          },
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
    void runtime.stop()
  })

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit()
  })

  mainWindow = createWindow()
  await showSplash('Starting DeepSeek Harness…')
  await runtime.start()
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
