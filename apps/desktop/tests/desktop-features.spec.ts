import { createServer } from 'node:http'
import { mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { resolvePptOfficePatch, writePptOfficeEnabled } from '../src/main/optional-features'
import { LanPairingBridge, firstLanIPv4 } from '../src/main/phone/lan-bridge'
import { assertPluginSpec, buildPluginArguments } from '../src/main/plugin-command'
import { SAFE_MODE_PROFILE, ensureSafeModeProfile, launchedInSafeMode } from '../src/main/safe-mode'
import { readSkippedVersion, shouldOfferUpdate, writeSkippedVersion } from '../src/main/update/skipped-version'
import { reduceUpdateStatus } from '../src/main/update/update-state'
import { UPDATE_GITHUB_OWNER, UPDATE_GITHUB_REPO, supportsAutoUpdates } from '../src/main/update/update-policy'

describe('desktop product controls', () => {
  it('keeps Safe Mode off the normal profile', async () => {
    const home = await mkdtemp(join(tmpdir(), 'dsh-safe-'))
    const webManifest = join(home, 'profiles', 'web', 'package.json')
    await writeFile(webManifest, '{"name":"keep"}\n').catch(async () => {
      const { mkdir } = await import('node:fs/promises')
      await mkdir(join(home, 'profiles', 'web'), { recursive: true })
      await writeFile(webManifest, '{"name":"keep"}\n')
    })
    await ensureSafeModeProfile(home)
    expect(await readFile(webManifest, 'utf8')).toBe('{"name":"keep"}\n')
    const safe = JSON.parse(await readFile(join(home, 'profiles', SAFE_MODE_PROFILE, 'package.json'), 'utf8')) as {
      dsh: { profile: { bundles: string[] } }
    }
    expect(safe.dsh.profile.bundles).toEqual(['@deepseek-ai/dsh-base', '@deepseek-ai/dsh-web-app'])
    expect(launchedInSafeMode(['electron', '.', '--safe-mode'])).toBe(true)
    expect(launchedInSafeMode(['electron', '.'])).toBe(false)
  })

  it('offers updates only for packaged macOS or Windows and this fork', () => {
    expect(supportsAutoUpdates(false, 'win32')).toBe(false)
    expect(supportsAutoUpdates(true, 'linux')).toBe(false)
    expect(supportsAutoUpdates(true, 'win32')).toBe(true)
    expect(`${UPDATE_GITHUB_OWNER}/${UPDATE_GITHUB_REPO}`).toBe('66208676/deepseek-harness')
    expect(shouldOfferUpdate('1.2.3', '1.2.3', false)).toBe(false)
    expect(shouldOfferUpdate('1.2.3', '1.2.3', true)).toBe(true)
    const status = reduceUpdateStatus(
      { phase: 'idle', currentVersion: '0.0.0', manual: false },
      { type: 'unsupported', message: 'dev' },
    )
    expect(status.phase).toBe('unsupported')
  })

  it('round-trips a skipped update version', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'dsh-skip-'))
    const path = join(dir, 'update-skip.json')
    writeSkippedVersion(path, '9.9.9')
    expect(readSkippedVersion(path)).toBe('9.9.9')
  })

  it('rejects plugin specs that look like flags', () => {
    expect(buildPluginArguments('web', 'add', 'left-pad')).toEqual(['plugin', '--profile', 'web', 'add', 'left-pad'])
    expect(() => assertPluginSpec('--force')).toThrow(/flag/u)
    expect(() => assertPluginSpec('ok\nname')).toThrow(/multiline/u)
  })

  it('blocks PPT/Office until review and a vendored manifest exist', async () => {
    const desktop = await mkdtemp(join(tmpdir(), 'dsh-desk-'))
    const userData = await mkdtemp(join(tmpdir(), 'dsh-user-'))
    const output = join(userData, 'optional-ppt.patch.yml')
    expect(resolvePptOfficePatch(desktop, userData, output).path).toBeUndefined()
    writePptOfficeEnabled(userData, true)
    expect(resolvePptOfficePatch(desktop, userData, output).blockedReason).toBe('license-review-required')
  })

  it('selects a non-internal IPv4 address', () => {
    expect(firstLanIPv4({ lo: [{ address: '127.0.0.1', family: 'IPv4', internal: true, netmask: '', mac: '', cidr: null }] })).toBeUndefined()
    expect(firstLanIPv4({ eth: [{ address: '10.0.0.8', family: 'IPv4', internal: false, netmask: '', mac: '', cidr: null }] })).toBe('10.0.0.8')
  })

  it('proxies a paired phone request and rejects a missing token', async () => {
    const harness = createServer((req, res) => {
      if (req.url?.includes('token=launch')) {
        res.writeHead(302, { 'set-cookie': ['dsh=session; HttpOnly; Path=/'], location: '/' })
        res.end()
        return
      }
      res.writeHead(200, { 'content-type': 'text/plain' })
      res.end(req.headers.cookie ?? 'no-cookie')
    })
    await new Promise<void>(resolve => harness.listen(0, '127.0.0.1', () => resolve()))
    const port = (harness.address() as { port: number }).port
    const bridge = new LanPairingBridge()
    try {
      const pairing = await bridge.start(`http://127.0.0.1:${port}/?token=launch`)
      const ok = await fetch(pairing.url)
      expect(await ok.text()).toContain('dsh=session')
      const denied = await fetch(new URL(pairing.url).origin)
      expect(denied.status).toBe(401)
    } finally {
      await bridge.stop()
      await new Promise<void>(resolve => harness.close(() => resolve()))
    }
  })
})
