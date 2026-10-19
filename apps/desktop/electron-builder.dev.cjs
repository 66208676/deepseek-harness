/** @type {import('electron-builder').Configuration} */
module.exports = {
  appId: 'ai.deepseek.dsh.desktop.dev',
  productName: 'DSH Desktop (Dev)',
  directories: {
    output: 'release',
    buildResources: 'build',
  },
  files: ['out/**/*', 'patches/**/*', 'package.json'],
  publish: {
    provider: 'github',
    owner: '66208676',
    repo: 'deepseek-harness',
  },
  asar: true,
  win: {
    target: ['dir'],
  },
  mac: {
    target: ['dir'],
  },
  linux: {
    target: ['dir'],
  },
}
