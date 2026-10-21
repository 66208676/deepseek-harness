/**
 * Cordis plugin: expose `desktopRuntime` so dsh-purge restarts through the
 * Electron shell instead of spawning a standalone `dsh web` + browser.
 * @module
 */

export const name = 'dsh-desktop-host-runtime'

/**
 * @param {import('@deepseek-ai/cordis').Context} ctx
 */
export function apply(ctx) {
  console.error('[dsh-desktop-host-runtime] desktopRuntime.requestRestart is available')
  ctx.provide('desktopRuntime', {
    /**
     * Ask Electron main to recycle the Harness child. Delayed so the purge
     * HTTP restart response can flush before this process is killed.
     * @returns {Promise<void>}
     */
    requestRestart() {
      const base = process.env.DSH_DESKTOP_CONTROL_URL
      if (!base) {
        return Promise.reject(new Error('DSH_DESKTOP_CONTROL_URL is not set'))
      }
      const url = `${base.replace(/\/$/u, '')}/restart`
      setTimeout(() => {
        void fetch(url, { method: 'POST' }).catch((error) => {
          console.error('[dsh-desktop-host-runtime] restart signal failed:', error)
        })
      }, 400)
      return Promise.resolve()
    },
  })
}
