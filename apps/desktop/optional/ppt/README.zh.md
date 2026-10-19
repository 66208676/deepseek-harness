# 可选 PPT 运行时

[English](README.md) | 中文

本目录留给已完成许可审查的 PPT composer 包。桌面壳不携带该包。

Harness 菜单可以记下开启 PPT/Office 的请求。只有下列两个文件都存在时，[resolvePptOfficePatch](../../src/main/optional-features.ts) 才会写入 composer overlay：

- `LICENSE-REVIEWED` — 模板及任何第三方幻灯片来源的许可与出处审查已经完成
- `package.json` — 已纳入仓库的 composer 包清单

在此之前，正常 web profile 启动时不带 PPT patch。Office 技能见 [../office/README.zh.md](../office/README.zh.md)，规则相同。
