/**
 * Preload for shell-owned dialogs. Not attached to the Harness window.
 * @module
 */

import { contextBridge, ipcRenderer } from 'electron'

contextBridge.exposeInMainWorld('dshShellDialog', {
  /**
   * Send the field value to the main process.
   * @param value - raw input
   */
  submit(value: string): void {
    ipcRenderer.send('desktop-shell:submit', value)
  },
  /** Close the dialog without a value. */
  cancel(): void {
    ipcRenderer.send('desktop-shell:cancel')
  },
})
