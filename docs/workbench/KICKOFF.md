# 交给云端会话执行

## 1. 云端环境（只需配一次）

在 claude.ai/code 新建环境，选择仓库 `Rajahn/dotflowy`。

**网络**：选 Custom，勾选包含默认允许列表，再加上：

```
cdn.playwright.dev
playwright.download.prss.microsoft.com
playwright.azureedge.net
playwright-akamai.azureedge.net
playwright-verizon.azureedge.net
archive.ubuntu.com
security.ubuntu.com
workers.cloudflare.com
```

前五个用于下载 Playwright 的 Chromium，两个 ubuntu 源供 `--with-deps` 装系统库，`workers.cloudflare.com` 是 `wrangler dev` 启动时取 `cf.json` 用的（取不到也能跑，只是会报警告）。

**环境变量**：

```
WRANGLER_SEND_METRICS=false
```

不需要任何密钥：本地 `BETTER_AUTH_SECRET` 由 `bun run setup` 生成在 `.dev.vars`，不进仓库。

**Setup script**：

```bash
#!/bin/bash
set -euo pipefail
if [ "$(bun --version 2>/dev/null || true)" != "1.4.2" ]; then
  npm install -g bun@1.4.2
fi
bun --version
```

## 2. 启动提示词（粘贴到新会话）

```
在 Rajahn/dotflowy 上执行多栏工作台方案。

先读 AGENTS.md、docs/workbench/PLAN.md、docs/workbench/STATUS.md，从 STATUS 的"下一步"开始，按 PLAN 第 3 节逐期推进（P0→P9）。

授权：
- 本方案已豁免 /grill-with-docs，按 PLAN 4.1 人工对照 ADR。
- 每期一个分支、一个 PR 到 Rajahn/dotflowy 的 main；第 5 节门槛全过并用 /code-review 自查后，可以自行合并。合并不了就按 PLAN 4.2 叠加分支。
- 遵守 PLAN 4.1 的禁区：不碰 billing/auth/landing/部署配置/邮件/Lunora 保留导出，不访问生产环境，不联系上游仓库，不推 tag。

方案没覆盖、或与已有 ADR 冲突的点，记进 STATUS"需要决定"，继续做其他部分。每期结束更新 STATUS。全部完成或只剩阻塞项时停止，关闭 cf:dev 等后台进程，最后给出总结。
```

## 3. 过程中怎么看

- 进度看 `docs/workbench/STATUS.md`（每期合并后更新）和仓库的 PR 列表。
- 会话停在"需要决定"时，在会话里直接回复决定，或改 STATUS 后让它继续。
- 会话中途结束、额度用完：新开一个会话，粘贴同一段提示词即可，它会从 STATUS 的"下一步"继续。
