import { describe, expect, it } from 'vitest'
import {
  buildHarnessArguments,
  extractLaunchToken,
  extractLaunchUrl,
} from '../src/main/runtime/harness-runtime'

describe('desktop harness launch helpers', () => {
  it('builds web argv with --no-open and optional patch', () => {
    expect(buildHarnessArguments(43129)).toEqual([
      'web',
      '--no-open',
      '--host',
      '127.0.0.1',
      '--port',
      '43129',
    ])
    expect(buildHarnessArguments(8080, ['/tmp/desktop.patch.yml'])).toEqual([
      'web',
      '--patch',
      '/tmp/desktop.patch.yml',
      '--no-open',
      '--host',
      '127.0.0.1',
      '--port',
      '8080',
    ])
    expect(buildHarnessArguments(8080, [], 'desktop-safe-mode')).toEqual([
      '--profile',
      'desktop-safe-mode',
      '--no-open',
      '--host',
      '127.0.0.1',
      '--port',
      '8080',
    ])
  })

  it('extracts launch URL and token from dsh web ready lines', () => {
    const line = 'dsh web: http://127.0.0.1:43129/?token=abc123'
    expect(extractLaunchUrl(line)).toBe('http://127.0.0.1:43129/?token=abc123')
    expect(extractLaunchToken(line)).toBe('abc123')
    expect(extractLaunchToken('unrelated')).toBeUndefined()
  })
})
