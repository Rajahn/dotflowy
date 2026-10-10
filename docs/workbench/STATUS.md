# 工作台实施状态

方案见 [`PLAN.md`](./PLAN.md)。每期结束由执行会话更新本文件。

## 下一步

P3（缩放与 URL 解耦、页签模型）：分支 `workbench/p3-tabs`。P3–P9 已在本地按顺序叠好（每期一个分支，依次基于上一期），逐期 rebase 到 main、跑门槛、开 PR、合并。

## 分期进度

| 期  | 内容                        | 状态   | PR      | 备注                             |
| --- | --------------------------- | ------ | ------- | -------------------------------- |
| P0  | 环境与基线                  | 完成   | 见本 PR | 基线见下表；修了一个 e2e fixture |
| P1  | PaneContext（行为不变）     | 完成   | #2      | 门槛见下方"P1 门槛"              |
| P2  | 每列独立滚动                | 完成   | 见本 PR | 宽屏列内滚动；窄屏保留窗口滚动   |
| P3  | 缩放与 URL 解耦、页签模型   | 未开始 |         |                                  |
| P4  | Library 与侧栏              | 未开始 |         |                                  |
| P5  | 多列布局与页签界面          | 未开始 |         |                                  |
| P6  | 跨列拖拽与复制              | 未开始 |         |                                  |
| P7  | 键盘移动、移动到…、撤销回位 | 未开始 |         |                                  |
| P8  | MCP library 工具            | 未开始 |         |                                  |
| P9  | 移动端、文档、收尾          | 未开始 |         |                                  |

## 基线（P0 填写）

在未改动的 `main`（`d04e0fd`）上跑。

| 门槛             | 结果                                    | 备注                                                                                                                              |
| ---------------- | --------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| fmt:check        | 通过                                    |                                                                                                                                   |
| lint             | 通过                                    | 0 error，若干既有 warning（`react/refs`、`react/immutability` 等，#345 跟踪）                                                     |
| typecheck        | 通过                                    |                                                                                                                                   |
| typecheck:worker | 通过                                    |                                                                                                                                   |
| typecheck:test   | 通过                                    |                                                                                                                                   |
| test             | 通过                                    | 1132 pass                                                                                                                         |
| check:docs       | 通过                                    |                                                                                                                                   |
| check:changeset  | 通过                                    |                                                                                                                                   |
| test:e2e:app     | 489 pass / 16 fail（43 分钟，1 worker） | 见下方"已知失败"                                                                                                                  |
| test:e2e:real    | 通过                                    | capture 9 pass，retirement 全部 pass                                                                                              |
| MCP 冒烟 / #330  | 通过，未复现                            | `tools/list`（12 个工具）、`add_node`、`update_node`、`move_nodes`、`delete_node` 全部成功；含 patch/delete 的写入没有出现 -32603 |

### 已知失败（e2e:app 基线）

- **确定失败，已在本 PR 修复**：`classic-recovery.spec.ts` ×4。测试自带的 `node()` 构造器缺 `locked` 字段（ADR 0067 加字段时漏改），planner 解码时报 `Missing key at ["locked"]`。补 `locked: false` 后 4 条全过。只改测试 helper，没碰 Lunora 保留导出。
- **确定失败，环境相关，未修**：`week-calendar.spec.ts:461`（"enabling reduced motion cancels an active pill without replay"）。单独重跑仍失败：`page.emulateMedia({ reducedMotion: "reduce" })` 之后选中块仍带 `week-calendar-selection-slide`。怀疑是本机 Chromium 141（见下）与 motion 的 reduced-motion 监听不配合。后续各期以"不新增失败"为准，这一条列为已知。
- **确定或高频失败，main 上同样存在**：`undo-redo.spec.ts:527`（"undo in a filter input does not undo outline authoring"）。在 main 上单独重复 3 次全部失败，P1 上 3 次失败 2 次；与工作台无关，列为已知。
- **负载抖动（单独重跑全过）**：`drag-reorder:88`、`emphasis:132/145`、`opml-import:193`、`route-bible:206/245/310`、`settings:239`、`todos:293`、`zoom-perf:98/120`。都是首屏 5 秒内没渲染出来，属于本机 4 核下 Vite dev server 被打满。

### 云端环境备注（给后续会话）

- bun 1.4.2；`bun install --frozen-lockfile` 正常。
- Playwright 1.63 需要 chromium-1243，环境只预装了 chromium-1194（Chromium 141），且系统提示不允许 `playwright install`。做法：在 scratchpad 建一个 `PLAYWRIGHT_BROWSERS_PATH` 目录，用符号链接把 `chromium-1243/chrome-linux64`、`chromium_headless_shell-1243/chrome-headless-shell-linux64` 指向 1194 的文件。不改仓库配置。
- 本机 4 核：`--workers=2` 会让 Vite dev server 饱和，一半用例首屏超时。用 1 个 worker，并在 globalSetup 里先预热 `/`、`/settings`，全量约 43 分钟。这两项放在 scratchpad 的包装 config 里（复制到仓库根的 `.pw-local.config.ts`，已加入 `.git/info/exclude`），不进仓库。
- `bun run setup` 里 opensrc 拉 Effect 源码会因 GitHub API 不通失败，脚本本身容错，不影响。
- `cf:dev` 在 :8787 正常；`seed:user` → `comp:dev-plan` → `mint:mcp-token` 正常。bearer 只放在 scratchpad 文件里，由脚本读取，未写入仓库或日志。
- 不要用 `pkill -f <模式>`：模式会匹配到执行命令的 shell 本身，把当前命令杀掉。

## 需要决定

（执行中遇到方案未覆盖、或与已有 ADR 冲突的点，记在这里：问题、选项、倾向、影响到哪一期。）

已知待定，不阻塞本轮：

- 自托管时 MCP 的付费门槛：直接在 D1 插一条订阅行（不改代码，同 `scripts/comp-dev-plan.ts`），还是加一个配置开关跳过门槛。本轮不改 billing。

- **平板（≥ 768px、触屏）的软键盘**（P2）：滚动方式只按宽度选，平板走列内滚动。列高是 `h-dvh`，iOS 弹出键盘时不缩，底部几行可能被键盘挡住；手机端的键盘工具条按 visualViewport 定位，不受影响。本环境没有真机，没验证。选项：A. 维持现状，等真机反馈；B. 粗指针设备也用窗口滚动（代价是平板只能单列）。倾向 A。
- **跨过 768px 时编辑器重挂载**（P2）：虚拟列表的滚动源在挂载时定死，所以宽窄切换（iPad 转屏、拖窗口）会重挂编辑器。已把光标所在行和偏移带过重挂载（`focus-carry.ts`）；滚动位置和多选不带。倾向维持。
- **宽屏下没有焦点时 Space/PageDown 不滚动**（P2）：窗口不再滚动，列内滚动元素不可聚焦。点一下列内即可。倾向维持。

### P1 门槛

全量 e2e 490/505；除已知两条外，其余失败在单独重跑时全部通过。新增单测：按列读写 view-state、宿主分发热键。

### P2 门槛

全部静态门槛通过。全量 e2e（审查修改前的提交）484/505；21 条失败单独重跑后剩 3 条：`week-calendar:461`（已知），以及两条由本期引起、已修复的：`completion-transition:410`（测试用 `window.scrollY` 换算坐标，列内滚动时不对，改用新 fixture `outlineContentTop`）、`mobile-drawers:627`（跨 768px 重挂载丢光标，见"需要决定"，已修）。修复后 completion-transition、mobile-drawers、zoom-navigation 三个 spec 43/43 通过；drag-reorder、virtualized-windowing 单独跑通过。perf guard（计数型）全部通过。/code-review 提出 10 条：修了 4 条（拖拽每帧每行读 DOM 改为每帧一次、滚动方式以列的标志为准不再探测 DOM、html 滚动条槽断点改用 px、PaneContext 默认值注释），2 条在后续期已解决（router 只重置第一个滚动元素：P3 去掉；多列纵向堆叠：P5 改为横向布局），3 条记入上面"需要决定"，1 条（换算重复）不改。

## 偏离方案记录

（实现与 PLAN 不同的地方及原因。）

- P0：PLAN 说 P0 只改 STATUS 和空 changeset。另外修了 `e2e/classic-recovery.spec.ts` 的一行 fixture（补 `locked: false`），否则后续每期的 e2e 门槛都带着 4 条确定失败。
- 全期：本地 e2e 用 1 个 worker + 预热（见上），而不是 CONTRIBUTING 里的 `--workers=2`。
- 全期：PLAN 4.2 写的是用 `gh api` 开 PR、合并；本会话没有 `gh`，改用 GitHub MCP 工具做同样的 REST 操作。
- P1：查询筛选的输入框控制器和 Cmd+F 仍是全局，推迟到 P3（筛选变成页签状态时一起改）。
- P2：手机（< 768px）保留窗口滚动，没有改成元素滚动。PLAN 2.3 允许"问题严重时移动端保留窗口滚动"；这里没有等到出问题，因为键盘工具条、输入抽屉、地址栏收起都依赖窗口滚动（ADR 0030、0066），改动风险大、收益小。结论写进 P3 新增的工作台 ADR（Scrolling 一节）。
