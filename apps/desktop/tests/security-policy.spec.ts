import { describe, expect, it } from 'vitest'
import { canGrantWindowPermission, isTrustedAppUrl } from '../src/main/security-policy'

describe('desktop security policy', () => {
  it('trusts loopback Harness, file, and splash data URLs', () => {
    expect(isTrustedAppUrl('http://127.0.0.1:43129/?token=abc')).toBe(true)
    expect(isTrustedAppUrl('http://localhost:43129/')).toBe(true)
    expect(isTrustedAppUrl('file:///tmp/recovery.html')).toBe(true)
    expect(isTrustedAppUrl('data:text/html;charset=UTF-8,hi')).toBe(true)
    expect(isTrustedAppUrl('https://example.com/')).toBe(false)
    expect(isTrustedAppUrl('http://192.168.1.1/')).toBe(false)
  })

  it('allows only main-frame clipboard and notifications on Harness', () => {
    expect(
      canGrantWindowPermission('clipboard-sanitized-write', 'http://127.0.0.1:43129/', true),
    ).toBe(true)
    expect(canGrantWindowPermission('notifications', 'http://127.0.0.1:43129/', true)).toBe(true)
    expect(
      canGrantWindowPermission('clipboard-sanitized-write', 'http://127.0.0.1:43129/', false),
    ).toBe(false)
    expect(canGrantWindowPermission('geolocation', 'http://127.0.0.1:43129/', true)).toBe(false)
    expect(canGrantWindowPermission('notifications', 'https://example.com/', true)).toBe(false)
  })
})
