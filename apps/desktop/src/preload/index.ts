/**
 * Minimal preload bridge for the desktop shell.
 * Context isolation stays on; expand IPC here only for host-owned actions.
 * @module
 */

import { contextBridge } from 'electron'

contextBridge.exposeInMainWorld('dshDesktop', {
  /**
   * Shell identity for diagnostics and future host bridges.
   * @returns fixed shell name
   */
  shell: (): string => 'dsh-desktop',
})
