# Optional PPT runtime

English | [中文](README.zh.md)

This directory is the place a reviewed PPT composer package would live. The desktop shell does not vendor that package.

The Harness menu can record a request to enable PPT/Office. [resolvePptOfficePatch](../../src/main/optional-features.ts) writes a composer overlay only when both of these files exist:

- `LICENSE-REVIEWED` — a completed license and provenance review for the templates and any third-party slide sources
- `package.json` — the vendored composer package manifest

Until those files exist, the normal web profile starts without a PPT patch. Office skills stay in [../office/README.md](../office/README.md) and follow the same rule.
