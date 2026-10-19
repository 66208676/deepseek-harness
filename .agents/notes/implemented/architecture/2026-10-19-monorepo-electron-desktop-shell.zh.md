# Agent Note: monorepo Electron desktop shell

Status: implemented

[English](2026-10-19-monorepo-electron-desktop-shell.md) | 中文

## Problem

DeepSeek Harness 已有 CLI 与 Web profile（`apps/cli`、`apps/web`），但仓库内没有原生窗口宿主。外部已有壳：dataelement/dsh-desktop（Electron 产品壳，含市场/PPT/手机等）与 web-casa/DeepSeek-Harness-Desktop（Tauri + 捆绑 Node + npm 钉死的 `@deepseek-ai/dsh`）。把任一者整仓替换进本仓库，要么放弃 monorepo 源码面，要么钉住已发布 npm 快照，都与「Harness 可继续改、可跟上游合并」冲突。

## Decision

`apps/desktop`（`@deepseek-ai/dsh-desktop`）是本 monorepo 内的薄 Electron 壳。Electron main 在 loopback 上启动工作区 `dsh web`（`node --import tsx/esm apps/cli/src/bin.ts web --no-open --host 127.0.0.1 --port <n>`，可选 `--patch apps/desktop/patches/desktop.patch.yml`），等待 `dsh web:` 就绪行，再在沙箱 `BrowserWindow`（`contextIsolation`、渲染进程无 Node）中加载该 URL。`DSH_HOME` 位于 Electron `userData`，不落在仓库树内。仅桌面的 Cordis 组合落在 `apps/desktop/patches/`；不为窗口外观去改核心包或默认 bundle。

根脚本 `desktop:dev` / `desktop:build` 委托给该包。拓扑对齐 dataelement 的 main→Harness→窗口；生命周期与安全边界对齐 web-casa「壳管进程与窗口，Harness 保持上游形态」，但不引入 Tauri 或第二套 Node。

## Alternatives considered

**用 dataelement/dsh-desktop 替换 monorepo。** 否决：该产品消费已发布的 `@deepseek-ai/dsh*`，并带市场/PPT/手机等产品面，不是继续开发 Harness 的源码工作区。

**采用 web-casa 的 Tauri + sidecar + 捆绑 Node，并钉 `@deepseek-ai/dsh`。** 否决：引入 Rust 工具链，并在 workspace 包之外再钉一份 npm，每次 Harness 改动都要走发布/升钉，与本 fork 目标相反。

**首期就 vendoring 完整 dataelement 产品插件（client-ui、市场、PPT、手机）。** 否决：超出「仅增加桌面壳」；这些能力扩大与上游的合并面，却不是在窗口里打开 Web UI 所必需。

## Consequences

- 开发者用 `pnpm desktop:dev` 跑与 `pnpm dsh web` 同一套源码 CLI；Harness 行为仍是一份代码。
- 上游 Harness 合并保持局部化：桌面回归对照 `dsh web` 启动契约（`--host`/`--port`/`--no-open`、就绪行标记），而不是对照一份 fork 过的 agent 运行时。
- 打包态 Electron-as-Node 分发、自动更新、Safe Mode、手机桥、Office/PPT 仍延后；MVP 用系统/npm Node + tsx 做源码拉起。
