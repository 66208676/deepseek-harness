# `@deepseek-ai/dsh-desktop`

English | [中文](README.zh.md)

Electron desktop shell for this monorepo. It starts the workspace `dsh web` profile on loopback and loads the Harness UI in a sandboxed window. It does not fork or reimplement the agent runtime.

## Architecture

```text
Electron Main
  └─ child: node --import tsx/esm apps/cli/src/bin.ts web --no-open --host 127.0.0.1 --port <n> [--patch patches/desktop.patch.yml]
       └─ Harness Web UI on 127.0.0.1
BrowserWindow (sandbox + contextIsolation) → that URL
```

- Topology follows [dataelement/dsh-desktop](https://github.com/dataelement/dsh-desktop) (main supervises Harness; renderer stays unprivileged).
- Boundaries follow [web-casa/DeepSeek-Harness-Desktop](https://github.com/web-casa/DeepSeek-Harness-Desktop): Harness stays upstream-shaped; the shell owns lifecycle and security only.
- `DSH_HOME` is under Electron `userData` (`…/harness`), separate from the repo tree.

## Commands

From the repository root (after `pnpm install`):

```sh
pnpm desktop:dev      # electron-vite dev
pnpm desktop:build    # electron-vite build → apps/desktop/out
```

Inside this package:

```sh
pnpm dev
pnpm build
pnpm typecheck
pnpm package:dir      # optional local unpackaged dir build
```

Development expects Host/Client build artifacts that `dsh web` already needs (`pnpm run build` when Typert or frontend outputs are missing).

## Update policy

| Change type | Where it goes |
| --- | --- |
| Harness / agent / web UI | Normal monorepo PRs under `packages/`, `apps/cli`, `apps/web` |
| Desktop window, spawn, security | `apps/desktop/src/**` only |
| Desktop-only Cordis composition | `apps/desktop/patches/desktop.patch.yml` (and future desktop packages) |

**Do not** change `packages/core`, `agent-loop`, or default bundles solely for desktop chrome.

After merging upstream Harness, re-check the launch contract before bumping the shell:

1. `dsh web --help` still documents `--host` / `--port` / `--no-open` / `--trusted-host`.
2. Ready line still matches `dsh web: http://127.0.0.1:…` (token query may be present).
3. Desktop still passes `--no-open` so the system browser is not opened.

Shell improvements may be cherry-picked from dataelement `src/main/runtime/*` and security policy; use the web-casa upgrade checklist for supervision regressions (heartbeat, identity, env hygiene) without adopting Tauri.

## Desktop product controls

The Harness menu adds five shell-owned controls. None of them edit `packages/` or the normal profile's plugin directory except `dsh plugin add` / `remove`, which is the existing CLI.

- **Safe Mode** boots profile `desktop-safe-mode` (`@deepseek-ai/dsh-base` and `@deepseek-ai/dsh-web-app` only). `--safe-mode` selects it at launch. `profiles/web` is left in place.
- **Updates** use `electron-updater` against GitHub `66208676/deepseek-harness` and only in a packaged macOS or Windows build. Download and install wait for a dialog choice. Development launches do not contact the feed.
- **Plugins** prompt for a package spec, ask for confirmation, then run `dsh plugin --profile <name> add|remove`. The Harness window preload does not expose that command. The desktop patch loads `dsh-desktop-host-runtime` and sets `DSH_SURFACE=desktop` so plugins such as `dsh-purge` restart through Electron instead of opening a browser `dsh web`. The same child gets `DSH_BASE` pointed at the workspace `node_modules/.pnpm/node_modules/@deepseek-ai` and `DSH_DESKTOP_INSTALL` pointed at the repo root, which is the package root purge looks for when there is no packaged `resources/app`.
- **Phone** opens a short-lived LAN reverse proxy. The phone uses a pairing query; Harness stays on `127.0.0.1`. Disconnect closes the proxy. Public tunnels are not included.
- **PPT/Office** can be requested from the menu, but the composer overlay is written only when `optional/ppt/LICENSE-REVIEWED` and `optional/ppt/package.json` both exist. See [optional/ppt/README.md](optional/ppt/README.md).

## Still out of scope

Public phone tunnels, a browsable plugin market UI, vendored PPT/Office runtimes, and a separate Node/npm pin of `@deepseek-ai/dsh`.
