# Agent Note: monorepo Electron desktop shell

Status: implemented

English | [中文](2026-10-19-monorepo-electron-desktop-shell.zh.md)

## Problem

DeepSeek Harness ships CLI and Web profiles (`apps/cli`, `apps/web`) but no in-repo native window host. External shells exist: dataelement/dsh-desktop (Electron product shell with market/PPT/phone features) and web-casa/DeepSeek-Harness-Desktop (Tauri + bundled Node + npm-pinned `@deepseek-ai/dsh`). Forking either into this repository as a replacement would either abandon the monorepo source plane or pin a published npm snapshot, both of which fight “keep Harness editable and mergeable with upstream.”

## Decision

`apps/desktop` (`@deepseek-ai/dsh-desktop`) is a thin Electron shell inside this monorepo. Electron main starts workspace `dsh web` on loopback (`node --import tsx/esm apps/cli/src/bin.ts web --no-open --host 127.0.0.1 --port <n>` with optional `--patch apps/desktop/patches/desktop.patch.yml`), waits for the `dsh web:` ready line, and loads that URL in a sandboxed `BrowserWindow` (`contextIsolation`, no Node in the renderer). `DSH_HOME` lives under Electron `userData`, not the repo tree. Desktop-only Cordis composition stays in `apps/desktop/patches/`; core packages and default bundles are not edited for chrome.

Root scripts `desktop:dev` / `desktop:build` delegate to the package. Topology follows dataelement’s main→Harness→window pattern; lifecycle and security boundaries follow web-casa’s “shell owns process and window; Harness stays upstream-shaped” rule without adopting Tauri or a second Node runtime.

## Alternatives considered

**Replace the monorepo with dataelement/dsh-desktop.** Rejected: that product consumes published `@deepseek-ai/dsh*` and carries market/PPT/phone surface area; it is not a source workspace for continuing Harness development.

**Adopt web-casa’s Tauri + sidecar + bundled Node and pin `@deepseek-ai/dsh`.** Rejected: adds a Rust toolchain and an npm pin parallel to workspace packages, so every Harness change requires a publish/bump dance that this fork wants to avoid.

**Vendor the full dataelement product plugins (client-ui, market, PPT, mobile) in the first change.** Rejected: out of scope for “only add a desktop shell”; those features enlarge the merge surface with upstream without being required to open the Web UI in a window.

## Consequences

- Developers run `pnpm desktop:dev` against the same source CLI as `pnpm dsh web`; Harness behavior stays one codebase.
- Upstream Harness merges stay localized: desktop regressions are checked against the `dsh web` launch contract (`--host`/`--port`/`--no-open`, ready-line marker), not against a forked agent runtime.
- Source launch still uses system/npm Node plus tsx. Packaged Electron-as-Node distribution remains deferred.
- Shell-owned product controls live under `apps/desktop/src/main/` only: Safe Mode profile `desktop-safe-mode`, `electron-updater` against this fork's GitHub Releases (packaged macOS/Windows), `dsh plugin` add/remove after confirm, LAN phone pairing proxy (no public tunnel), and PPT/Office opt-in gated on `optional/ppt/LICENSE-REVIEWED` plus a vendored `package.json`.
- Source-launched Harness has no packaged `resources/app/@deepseek-ai`. The shell sets `DSH_BASE` to `node_modules/.pnpm/node_modules/@deepseek-ai` and `DSH_DESKTOP_INSTALL` to the repo root so `dsh-purge` can apply against the workspace packages and still restart through `desktopRuntime.requestRestart`.
