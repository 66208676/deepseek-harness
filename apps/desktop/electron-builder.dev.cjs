/** @type {import('electron-builder').Configuration} */
module.exports = {
  appId: 'ai.deepseek.dsh.desktop.dev',
  productName: 'DSH Desktop (Dev)',
  directories: {
    output: 'release',
    buildResources: 'build',
  },
  files: ['out/**/*', 'patches/**/*', 'package.json'],
  // electron-builder reads build/icon.png (and icon.ico on Windows) from buildResources.
  publish: {
    provider: 'github',
    owner: '66208676',
    repo: 'deepseek-harness',
  },
  asar: true,
  win: {
    target: ['dir'],
    icon: 'build/icon.ico',
  },
  mac: {
    target: ['dir'],
    icon: 'build/icon.png',
  },
  linux: {
    target: ['dir'],
    icon: 'build/icon.png',
  },
}
