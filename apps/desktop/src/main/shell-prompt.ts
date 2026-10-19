/**
 * Small shell-owned window that asks for one text value.
 * The Harness window does not receive this channel.
 * @module
 */

import { BrowserWindow, ipcMain } from 'electron'
import { join } from 'node:path'

const SUBMIT_CHANNEL = 'desktop-shell:submit'
const CANCEL_CHANNEL = 'desktop-shell:cancel'

/**
 * Ask the user for one line of text from a shell window.
 * @param title - window title
 * @param label - field label
 * @returns trimmed text, or undefined when cancelled
 */
export function promptShellText(title: string, label: string): Promise<string | undefined> {
  return new Promise((resolve) => {
    let settled = false
    const finish = (value: string | undefined): void => {
      if (settled) return
      settled = true
      ipcMain.removeListener(SUBMIT_CHANNEL, onSubmit)
      ipcMain.removeListener(CANCEL_CHANNEL, onCancel)
      if (!window.isDestroyed()) window.close()
      resolve(value)
    }

    const window = new BrowserWindow({
      width: 480,
      height: 220,
      title,
      resizable: false,
      minimizable: false,
      maximizable: false,
      webPreferences: {
        preload: join(__dirname, '../preload/shell-dialog.cjs'),
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
        webviewTag: false,
      },
    })

    const onSubmit = (event: Electron.IpcMainEvent, value: unknown): void => {
      if (event.sender.id !== window.webContents.id) return
      finish(typeof value === 'string' ? value : undefined)
    }
    const onCancel = (event: Electron.IpcMainEvent): void => {
      if (event.sender.id !== window.webContents.id) return
      finish(undefined)
    }
    ipcMain.on(SUBMIT_CHANNEL, onSubmit)
    ipcMain.on(CANCEL_CHANNEL, onCancel)
    window.on('closed', () => finish(undefined))

    const html = `<!doctype html>
<html><head><meta charset="utf-8" /><title>${escapeHtml(title)}</title>
<style>
  body { font-family: Segoe UI, system-ui, sans-serif; margin: 16px; background: #111; color: #eee; }
  label { display: block; margin-bottom: 8px; }
  input { width: 100%; box-sizing: border-box; padding: 8px; }
  div { margin-top: 12px; display: flex; gap: 8px; justify-content: flex-end; }
  button { padding: 6px 12px; }
</style></head>
<body>
<label>${escapeHtml(label)}</label>
<input id="value" />
<div>
  <button id="cancel" type="button">Cancel</button>
  <button id="ok" type="button">Continue</button>
</div>
<script>
  const input = document.getElementById('value')
  document.getElementById('ok').onclick = () => window.dshShellDialog.submit(input.value)
  document.getElementById('cancel').onclick = () => window.dshShellDialog.cancel()
  input.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') window.dshShellDialog.submit(input.value)
  })
</script>
</body></html>`
    void window.loadURL(`data:text/html;charset=UTF-8,${encodeURIComponent(html)}`)
  })
}

function escapeHtml(value: string): string {
  return value.replace(/&/gu, '&amp;').replace(/</gu, '&lt;').replace(/>/gu, '&gt;')
}
