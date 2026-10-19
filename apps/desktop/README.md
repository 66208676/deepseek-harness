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

## Out of scope (MVP)

Auto-update, phone bridge, Safe Mode, PPT/Office, plugin market installer, and bundling a separate Node/npm pin of `@deepseek-ai/dsh`.
