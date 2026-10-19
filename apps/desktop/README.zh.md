# `@deepseek-ai/dsh-desktop`

[English](README.md) | 中文

本 monorepo 的 Electron 桌面壳：在 loopback 上启动工作区 `dsh web` profile，并在沙箱窗口中加载 Harness UI。不 fork、不重写 agent 运行时。

## 架构

```text
Electron Main
  └─ child: node --import tsx/esm apps/cli/src/bin.ts web --no-open --host 127.0.0.1 --port <n> [--patch patches/desktop.patch.yml]
       └─ Harness Web UI on 127.0.0.1
BrowserWindow (sandbox + contextIsolation) → that URL
```

- 拓扑对齐 [dataelement/dsh-desktop](https://github.com/dataelement/dsh-desktop)（main 监管 Harness；renderer 保持无特权）。
- 边界对齐 [web-casa/DeepSeek-Harness-Desktop](https://github.com/web-casa/DeepSeek-Harness-Desktop)：Harness 保持上游形态，壳只负责生命周期与安全。
- `DSH_HOME` 位于 Electron `userData`（`…/harness`），与仓库目录分离。

## 命令

仓库根目录（先 `pnpm install`）：

```sh
pnpm desktop:dev      # electron-vite dev
pnpm desktop:build    # electron-vite build → apps/desktop/out
```

本包内：

```sh
pnpm dev
pnpm build
pnpm typecheck
pnpm package:dir      # optional local unpackaged dir build
```

开发态需要与 `dsh web` 相同的 Host/Client 构建产物；缺失 Typert 或前端产物时先执行 `pnpm run build`。

## 更新约定

| 变更类型 | 落点 |
| --- | --- |
| Harness / agent / Web UI | `packages/`、`apps/cli`、`apps/web` 的常规 monorepo PR |
| 窗口、拉起、安全策略 | 仅 `apps/desktop/src/**` |
| 仅桌面的 Cordis 组合 | `apps/desktop/patches/desktop.patch.yml`（及后续桌面包） |

**禁止**仅为桌面壳去改 `packages/core`、`agent-loop` 或默认 bundle。

合并上游 Harness 后，发壳前复核启动契约：

1. `dsh web --help` 仍文档化 `--host` / `--port` / `--no-open` / `--trusted-host`。
2. 就绪行仍匹配 `dsh web: http://127.0.0.1:…`（可能带 token query）。
3. 桌面仍传 `--no-open`，不打开系统浏览器。

壳侧改进可从 dataelement 的 `src/main/runtime/*` 与安全策略 cherry-pick；监督回归（heartbeat、identity、env hygiene）按 web-casa 升级清单核对，但不采用 Tauri。

## MVP 不做

自动更新、手机桥、Safe Mode、PPT/Office、插件市场安装器、以及另绑独立 Node / npm pin 的 `@deepseek-ai/dsh`。
