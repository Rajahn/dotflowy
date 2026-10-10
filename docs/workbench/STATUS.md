# 工作台实施状态

方案见 [`PLAN.md`](./PLAN.md)。每期结束由执行会话更新本文件。

## 下一步

全部九期完成（P9 合并后 main 即最终状态）。剩余只有下方"需要决定"里的待定项，都不阻塞使用。总结见文末"最终总结"。

## 分期进度

| 期  | 内容                        | 状态 | PR      | 备注                             |
| --- | --------------------------- | ---- | ------- | -------------------------------- |
| P0  | 环境与基线                  | 完成 | #1      | 基线见下表；修了一个 e2e fixture |
| P1  | PaneContext（行为不变）     | 完成 | #2      | 门槛见下方"P1 门槛"              |
| P2  | 每列独立滚动                | 完成 | #3      | 宽屏列内滚动；窄屏保留窗口滚动   |
| P3  | 缩放与 URL 解耦、页签模型   | 完成 | #4      | 页签持有缩放根；URL 映射活动页签 |
| P4  | Library 与侧栏              | 完成 | #5      | 文件夹/笔记；新 Seam S           |
| P5  | 多列布局与页签界面          | 完成 | #6      | 1–4 列、页签、布局记忆           |
| P6  | 跨列拖拽与复制              | 完成 | #7      | Alt 复制；一次放下一步撤销       |
| P7  | 键盘移动、移动到…、撤销回位 | 完成 | #8      | Ctrl+Alt+←/→；移动到…先列页签    |
| P8  | MCP library 工具            | 完成 | #9      | 4 个工具；Agent 文件夹           |
| P9  | 移动端、文档、收尾          | 完成 | 见本 PR | 手机抽屉侧栏与页签条；终审修复   |

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
- **筛选的"提交"（点标签）推入浏览器历史，但页签历史只按缩放根记**（P3）：`/A → 点标签 → /A?q=x` 之后按浏览器后退，页签按 rootId 匹配，可能回到更早的同根条目，前进栈随之错位。选项：A. 维持（只在"同一根反复进出 + 点标签"的组合下出现）；B. 页签历史按 (rootId, q) 记，提交筛选也压页签栈。倾向 B，但它改动页签模型和 ADR 0069 的 URL 规则，留给下一轮。
- **首屏现在先出骨架再淡入**（P3）：工作台挂在根路由上，比原来的叶子路由更早挂载，同步未就绪时先显示骨架屏，就绪后播一次 `outline-reveal`（260ms）。这是编辑器原有的"骨架→内容"设计，只是现在首屏也会走到。倾向维持；e2e 新增 `settleOutline` 等它结束再量坐标。

### P1 门槛

全量 e2e 490/505；除已知两条外，其余失败在单独重跑时全部通过。新增单测：按列读写 view-state、宿主分发热键。

### P2 门槛

全部静态门槛通过。全量 e2e（审查修改前的提交）484/505；21 条失败单独重跑后剩 3 条：`week-calendar:461`（已知），以及两条由本期引起、已修复的：`completion-transition:410`（测试用 `window.scrollY` 换算坐标，列内滚动时不对，改用新 fixture `outlineContentTop`）、`mobile-drawers:627`（跨 768px 重挂载丢光标，见"需要决定"，已修）。修复后 completion-transition、mobile-drawers、zoom-navigation 三个 spec 43/43 通过；drag-reorder、virtualized-windowing 单独跑通过。perf guard（计数型）全部通过。/code-review 提出 10 条：修了 4 条（拖拽每帧每行读 DOM 改为每帧一次、滚动方式以列的标志为准不再探测 DOM、html 滚动条槽断点改用 px、PaneContext 默认值注释），2 条在后续期已解决（router 只重置第一个滚动元素：P3 去掉；多列纵向堆叠：P5 改为横向布局），3 条记入上面"需要决定"，1 条（换算重复）不改。

### P3 门槛

全部静态门槛通过。最终提交的全量 e2e 497/507；10 条失败里 `week-calendar:461` 是已知环境问题，其余 9 条单独重跑全部通过（首屏超时类负载抖动）。期间修了两处由本期引起的真问题：编辑器在同步前挂载时 `scrollMargin` 只在挂载时量一次、量不到列表，导致虚拟行坐标整体偏一个页眉高度、拖放落到指针下方两行（`drag-reorder`、`drag-filtered`、`spotlight` 移动端）；以及骨架淡入期间量坐标的测试时序（`completion-transition`）。/code-review 提出 10 条：修了 9 条（`?q=` 用路由自己的 search 解析、缩放在过渡回调里再计算、首屏前解析 URL、只切活动列时也改写 URL、非缩放重挂载恢复滚动、浏览器前进后退按缩放进出落焦点、无需重挂载时 focus-last 立即落、撤销只切页签时 replace、工作台自带错误边界），1 条记入"需要决定"。新增 e2e `workbench-url.spec.ts`。

### P4 门槛

全部静态门槛通过。全量 e2e 503/508；`week-calendar:461`、`undo-redo:527` 是基线已知失败，`emphasis:184`、`highlight:266` 单独重跑通过，`workbench-library` 的失败是测试定位器不精确（"Roadmap" 同时匹配到 "Roadmap options" 按钮），改为精确匹配后通过。/code-review 提出 10 条：修了 9 条（重命名笔记改写源文本且不变不写、删除笔记在守卫通过后才退出缩放、新建笔记回滚时删掉 library 行、拖放按绘制所在文件夹、展开文件夹下方落为首个子项、并列 rank 的插入、一次遍历处理文件夹环、Seam S 增加 `changed()`、重复的删除条件），1 条（Sidebar 重复订阅）不改。

- **新插件 Seam S（`sidebarEntries`）**（P4）：按授权豁免 /grill-with-docs，人工对照 ADR 0001（新 seam 要有类型契约、在 docs/plugins.md 登记、可选特性随特性退出）。已登记，Daily 是首个使用者。
- **笔记行在节点不再是顶层时隐藏而不删除**（P4，ADR 0070）：撤销删除或把节点移回顶层时笔记回到原位；代价是 library 里可能积累隐藏行。倾向维持。

### P5 门槛

全部静态门槛通过。全量 e2e 507/510；`week-calendar:461` 已知；`virtualized-windowing:63`（拖到底边自动滚动，10 秒内要滚过约 5500px）单独重跑通过，属负载下的时序；`delete-command:71` 是本期有意的行为变化：删除缩放根会关闭显示它的页签（ADR 0069），测试改为断言空列和 `/`。/code-review 提出 10 条，全部修复（列上放笔记的 dropEffect、写入按历史条目记录的位置固定页签、布局保存在 pagehide/卸载时落盘、在列内容里按下不再挪光标、AltGr 不触发和弦、最后一列为空时 URL 回到 `/`、关列时清掉记住的行、宽度不变不提交且 Recent 跟随活动列、忽略别的窗口拖来的页签、把页签拖到已显示同一视图的列时聚焦那个页签）。

- **Linux 上 `Alt+1…4` 被 Chrome 占用**（P5）：Chrome 在 Linux 用 `Alt+1…8` 切浏览器标签，网页拦不住。Linux 用户用 `Ctrl+Alt+[` / `]` 或 Cmd+K 切列；`docs/keyboard.md` 已写明。倾向维持。
- **删除正在看的笔记会关掉它的页签**（P5，ADR 0069）：单列单页签时留下空列（有"最近打开"）。另一种是缩放到父节点。倾向维持关闭（与 VS Code 删除已打开文件的行为一致）。

### P6 门槛

全部静态门槛通过。全量 e2e 509/511；`week-calendar:461` 已知；`workbench-drag` 的失败都在测试本身：放到行旁的指针 x 偏右超过一级缩进（变成了子项）、撤销后焦点还没落定就开始下一次拖拽、侧栏按钮名不精确（"Archive" 同时匹配 "Archive options"）。修正后单独跑通过，代码未改。/code-review 提出 10 条：修了 8 条（复制镜像进其源时拒绝、按镜像解析后的父节点判断拒绝、跨列放下记录在目标列页签并经镜像落焦点/提示被过滤隐藏、镜像笔记根追加在源的子项末尾、文件夹放下归档所有移到顶层的根、悬停别列页签不再激活该列、只在列内容上方自动滚动、离开所有列时落回本列），1 条（文件夹放下的 library 行不进撤销）按 ADR 0070 的设计保留，1 条记入下面。

- **大子树复制一次完成，不分片**（P6）：Alt 复制上万节点时 pointerup 里同步插入，会卡一下。删除大子树已有分片路径（`runStructuralSliced`）。倾向下一轮按同样方式分片；本轮复制量通常很小。
- **跨列拖拽时源列不随悬停切换页签**（P6，ADR 0071）：源列的编辑器（和这次拖拽）会被重挂载，所以只切换别的列。倾向维持。

### P7 门槛

全部静态门槛通过。全量 e2e 512/514，失败的两条都是基线已知（`week-calendar:461`、`undo-redo:527`）。新增 `workbench-keyboard.spec.ts` 3 条全过，覆盖 PLAN 验收的"焦点落在源列下一个节点、撤销回到原列"；"上次聚焦位置"的规则有单测（含镜像、锁定、镜像根）。/code-review 提出 10 条，全部修复（落点与槽位按渲染键处理镜像、锁定父节点回退到末尾、记住的目标行改为落下节点的渲染键、不依赖目标列已渲染的行、选区只在源列时才移动、原地不动时不报错、Cmd+K 用打开时的快照、目标视图隐藏时提示、共用祖先判断）。

- **连续两次撤销，第二次可能被吞掉**（P7 测试中发现，非本期引入）：上一次撤销还在落定（history busy，ADR 0064）时按下的 Cmd+Z 会被直接丢弃，不排队。人手速度下很少遇到；测试里改为等 Cmd+K 的"撤销"重新可用再按。选项：A. 维持；B. busy 时把一次撤销请求排队。倾向 B，但它改 ADR 0064 的语义，留给下一轮。

### P8 门槛

全部静态门槛通过。worker 单测覆盖四个新工具的 schema、存储读写和边界（错误文件夹不留节点、Agent 文件夹复用与固定 id 不覆盖、Daily 容器拒绝、重复行一起移动、未知字段保留）。全量 e2e 512/514：`week-calendar:461` 已知，`undo-redo:417` 单独重跑通过。

本地 `cf:dev` 冒烟（新铸的 bearer 只在 scratchpad 文件里，未打印）：`tools/list` 列出 16 个工具 → `create_folder` "Smoke folder" → `create_note`（带两层子节点，自动建 "Agent" 文件夹并归档）→ `list_library` → `move_note` 到 "Smoke folder" → 再次 `list_library` 正确。用开发账号登录浏览器：侧栏里 "Smoke folder" 下显示该笔记，点开为预览页签，节点带 agent 来源标记。

/code-review 提出 8 条：修了 7 条（Agent 文件夹经 DO 原子 get-or-create 认领、复用绘制在顶层的同名文件夹、`move_note` 拒绝 Daily 容器并移动所有重复行、写回保留未知字段、读并发、行类型与 schema 绑定），1 条（错误包装的重复代码）不改。/security-review：没有可利用的问题（DO 按 `resolveUserId` 取、输入经 Effect Schema、kv 键由服务端生成、付费门槛覆盖新工具）；唯一的观察（两处回执里文件夹名未做 spoiler 遮蔽）已顺手修掉。

- **library 不实时推送，靠窗口聚焦时重新拉取**（P8，PLAN 1.10 要求本期决定是否轮询）：决定不加轮询，记在 ADR 0070。agent 建的节点经节点同步立即出现在"未归档"，聚焦后归位。

### P9 门槛

全部静态门槛通过；全量 e2e 结果见本 PR 描述。新增 `workbench-mobile.spec.ts`（375px：抽屉侧栏、页签条切换、"移动到…"先列已打开页签；767/768px 边界来回切换时两列布局保留）。/code-review（P9 本身）提出 9 条，全部修复（手机页签条去掉"右侧拆分"且窄屏禁用列和弦与 Cmd+K 列操作、页签条出现/消失时重新量列表偏移、抽屉在点开笔记时关闭而不是在任意根变化时、行菜单与侧栏按钮在粗指针下可见且更大、页签触控尺寸按指针类型、重命名里的 Escape 不再关掉抽屉、未用的导出）。

最终对从分叉点 `d04e0fd` 到 P9 的完整 diff 做了跨期 /code-review，提出 10 条：修了 9 条——空列时 Cmd+Z/Shift+Z 仍可撤销重做并把恢复的笔记在该列重新打开；侧栏重命名/删除在活动列为空时借用任一列的编辑器，全无编辑器时先打开该笔记；手机空列有侧栏按钮和"打开整个大纲"；关闭的列释放它的选区；不在任何行里发生的写入不再固定预览页签；删除文件夹时把其中隐藏的行上移一层、父文件夹不存在的行按根级排序；Cmd+K 增加上/下一个页签，文档写明唯一没有 Cmd+K 的是"按编号聚焦列"；ADR 0061 写明 library 工具暂时只能经 CLI 的 `call` 调用。剩 2 条：提交筛选与页签历史（见上），以及下面这条。

- **从 `/` 打开（含主屏启动）时聚焦"整个大纲"页签，而不是上次的活动页签**（P9 终审）：URL 是活动页签的投影，`/` 就是整个大纲；已有该页签就聚焦它，没有就新开一个。终审建议改为保留恢复的活动页签，试过后发现显式打开 `/` 就看不到整个大纲了（`opml-import` e2e 即依赖这一点），已撤回。选项：A. 维持（URL 语义优先）；B. 区分"冷启动到起始 URL"和"显式导航到 `/`"（需要 manifest 的 start_url 带参数）。倾向 A。

- **CLI 没有 library 工具的友好命令**（P8/P9）：四个新工具在 CLI 里只能用通用的 `call` 调用；`cli/README.md` 写的"支持全部 12 个工具"已过时。按授权 `cli/` 不在本轮范围内，只在 ADR 0061 里补了说明。选项：下一轮给 CLI 加 `library` 子命令并更新 README（触发 CLI 发布，ADR 0062）。

## 偏离方案记录

（实现与 PLAN 不同的地方及原因。）

- P0：PLAN 说 P0 只改 STATUS 和空 changeset。另外修了 `e2e/classic-recovery.spec.ts` 的一行 fixture（补 `locked: false`），否则后续每期的 e2e 门槛都带着 4 条确定失败。
- 全期：本地 e2e 用 1 个 worker + 预热（见上），而不是 CONTRIBUTING 里的 `--workers=2`。
- 全期：PLAN 4.2 写的是用 `gh api` 开 PR、合并；本会话没有 `gh`，改用 GitHub MCP 工具做同样的 REST 操作。
- P1：查询筛选的输入框控制器和 Cmd+F 仍是全局，推迟到 P3（筛选变成页签状态时一起改）。
- P3：误推了一个远端分支 `workbench/p3-tabs-next`（内容是 P3 的中间提交）。按授权不删远端分支，留着；可以手动删。
- P5/P6：早先一次 fixup 合并把 P6 的一部分（changeset、ADR 0071、拖拽 e2e、样式、拖放面注册）并进了 P5 的提交，P5 单独无法类型检查。合并前已拆回：P5 去掉这些，P6 用最终树重建。
- 全期：e2e 测试修正（不改断言意图）：定位器加 `exact`（"X" 会同时匹配 "X options" 菜单按钮）、等首屏淡入结束再量坐标（`settleOutline`）、等撤销落定再做下一步。
- P2：手机（< 768px）保留窗口滚动，没有改成元素滚动。PLAN 2.3 允许"问题严重时移动端保留窗口滚动"；这里没有等到出问题，因为键盘工具条、输入抽屉、地址栏收起都依赖窗口滚动（ADR 0030、0066），改动风险大、收益小。结论写进 P3 新增的工作台 ADR（Scrolling 一节）。

## 最终总结

在 `Rajahn/dotflowy` 上按 PLAN 第 3 节完成 P0–P9，每期一个分支、一个 PR（#1–#10），全部 squash 合并到 main。

- **做了什么**：编辑器从"一次一篇大纲"变成工作台——左侧是文件夹/笔记库（kv 侧集合，未归档自动派生，插件可加入口），右侧 1–4 列，每列有页签（预览/固定、拖动重排与跨列、布局按设备和账号记忆）；缩放根归页签所有，URL 映射活动页签，浏览器前进后退按页签历史解析；每列独立滚动（窄屏保留窗口滚动）；节点可跨列拖拽，Alt 深拷贝，一次放下一步撤销，撤销回到原页签；`Ctrl+Alt+←/→` 把选区移到相邻列；"移动到…"先列已打开页签；MCP 新增 `list_library`/`create_folder`/`create_note`/`move_note`，agent 笔记默认进 Agent 文件夹；手机上是单列 + 抽屉侧栏 + 页签条。
- **决策记录**：ADR 0069（页签持有视图根、URL 规则、布局与页签、窄屏）、ADR 0070（library、Seam S、agent 约定、不轮询）、ADR 0071（跨列拖拽与复制、键盘移动）；ADR 0019、0061、0064 加了修订说明。
- **验证**：每期全部静态门槛通过；每期全量 e2e 的失败都单独重跑核对过，只剩基线就已存在的 `week-calendar:461`（环境）和时有时无的 `undo-redo:527`；每期 /code-review 并修复，P8 另做 /security-review，最后对完整 diff 做跨期审查。MCP 在本地 `cf:dev` 用 bearer 实测过并在浏览器里核对结果。
- **没做 / 待定**：见"需要决定"——平板软键盘、筛选提交与页签历史、连续撤销被吞、大子树复制分片、CLI 的 library 命令、自托管 MCP 付费门槛。
