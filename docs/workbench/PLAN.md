# 多栏工作台（Workbench）实施方案

本仓库 `Rajahn/dotflowy` 从 `cameronapak/dotflowy` 的 `ed29647` 分叉，此后独立演进，不再同步上游；上游有需要的功能时再手动挑选合入。

目标：把"一次只看一篇大纲"的编辑器改成 VS Code 式工作台——左侧是文件夹和笔记，右侧是 1–4 列，每列带页签，可以在列之间直接拖拽层级。用途是自下而上整理思路：先在几篇笔记里收集细节，再把它们搬进一篇总分结构的文档。数据模型、同步协议、MCP 只做增量改动。

执行进度和待决事项写在 [`STATUS.md`](./STATUS.md)。新会话开始前先读 STATUS 的"下一步"。

---

## 1. 交互规格（已定稿）

### 1.1 概念

| 概念                | 含义                                                                                       |
| ------------------- | ------------------------------------------------------------------------------------------ |
| 文件夹（folder）    | 只存在于侧栏，可嵌套，只用来归类笔记，不含大纲内容                                         |
| 笔记（note）        | 一份大纲。内容是一个普通的顶层节点（`parentId = null`）及其子树；笔记标题 = 该根节点的文本 |
| 列（column / pane） | 工作台里的一个竖栏，1–4 个，从左到右排列                                                   |
| 页签（tab）         | 列内的一个视图 = 某个节点的缩放视图（zoom），外加该视图自己的筛选 `q` 和前进/后退栈        |

文件夹和笔记分开（同幕布）：文件夹不是大纲节点，笔记也不能"放进"另一篇笔记的大纲里——那叫移动节点，属于拖拽规则。

### 1.2 侧栏

- 树形显示文件夹和笔记；文件夹可折叠，折叠状态存在本机（localStorage）。
- 顶部固定项：
  - **全部大纲**：根视图（`rootId = null`），用于直接操作所有顶层节点。
  - **Daily**：每日笔记开启时显示，打开 Daily 容器节点。
- 底部虚拟文件夹 **未归档**：所有没有登记为笔记的顶层节点（种子数据、旧数据、MCP 新建的顶层节点）。可以把它们拖进文件夹，登记为笔记。
- 操作：新建文件夹、新建笔记（在当前文件夹下，生成根节点"未命名"并进入编辑）、重命名（笔记重命名 = 改根节点文本）、拖拽排序或移入其他文件夹。
- 删除：
  - 文件夹第一版只能删空的；非空时提示先移走或删除其中的笔记。
  - 删除笔记 = 删除根节点子树，走现有删除和撤销。笔记登记行暂不删除；登记行指向的节点不存在时，这一行在侧栏隐藏。撤销恢复节点后，笔记回到原位置。

### 1.3 列与页签（VS Code 规则）

- **预览页签**：在侧栏单击笔记，它以预览页签（斜体标题）在当前活动列打开；同一列再单击另一篇笔记时，替换这个预览页签。以下情况把预览页签转为固定页签：
  - 对该页签内容的任何写操作（打字、拖入、粘贴等）；
  - 双击页签；
  - 在侧栏双击该笔记。

  在预览页签里缩放不会固定它。

- `Cmd/Ctrl+点击` 侧栏笔记：在当前列新开固定页签。把侧栏笔记拖到某一列（页签栏或内容区）：在那一列打开。
- 同一节点在**同一列**已经打开时，切到已有页签，不重复开。**不同列**可以打开同一笔记甚至同一节点，内容实时同步。
- **拆分**：在活动列右侧新建一列，复制活动页签（同一缩放节点）。已有 4 列时禁用并提示。
- 页签可以在列内重排，也可以拖到别的列；拖走最后一个页签时，原列关闭。
- 关闭列中最后一个页签时，该列关闭；只剩一列时显示空状态（"从左侧打开笔记" + 最近打开的笔记）。
- 列宽用分隔条拖动调整，双击分隔条恢复等宽。列最小宽度约 280px；视口放不下时，工作台区域横向滚动。
- 页签标题：缩放节点的文本（截断），悬停显示完整路径（笔记名 › … › 节点）。
- 在页签内缩放（点 bullet、`Cmd/Ctrl+.`、面包屑）只改变该页签，不影响其他列。

### 1.4 拖拽规则

原则：**拖到内容区 = 移动内容；拖到页签栏 = 打开视图**。

| 拖拽起点 → 落点                    | 结果                                                                         |
| ---------------------------------- | ---------------------------------------------------------------------------- |
| 节点 → 本列大纲                    | 现有行为（重排或改层级）                                                     |
| 节点 → 另一列大纲                  | 连子树移动到落点；层级按指针 x 位置算，规则与列内一致                        |
| 按住 `Alt/Option` 拖到任意大纲     | 深拷贝子树到落点（规则见 2.7），原节点不动；拖拽影像显示"复制"标记           |
| 节点悬停在某列的某个页签上约 500ms | 该列切到这个页签，拖拽继续                                                   |
| 节点 → 页签栏空白处                | 在那一列新开页签，缩放到被拖节点；不移动                                     |
| 节点 → 侧栏笔记                    | 移动为该笔记根节点的最后一个子节点（`Alt` = 复制）                           |
| 节点 → 侧栏文件夹                  | 节点脱离原位置成为顶层节点，并登记为该文件夹下的新笔记（`Alt` = 复制后登记） |
| 侧栏笔记 → 列                      | 在该列打开（见 1.3）                                                         |
| 页签 → 另一列页签栏                | 移动页签                                                                     |
| 任意拖拽中按 `Esc`                 | 取消                                                                         |

- 多选（`Shift+↑/↓` 选中的一串）拖拽时整体移动或复制，保持顺序。
- 锁定节点、镜像节点沿用现有规则（ADR 0067、ADR 0022）；不允许的落点显示禁用光标。
- 每次放下只产生一步撤销。

### 1.5 键盘

- `Ctrl+Alt+→ / ←`：把选中节点（没有选区时是光标所在节点）移到右/左相邻列活动页签中**上次聚焦的位置之后**，作为其后续兄弟；该列从未聚焦过时，放在缩放根的最后。焦点留在源列，落到原位置的下一个节点（没有就落到上一个，再没有就落到父节点）。
- "移动到…"选择器（现有 move dialog）：在最前面列出"已打开的页签"作为快捷目标，其余不变。
- 其余工作台快捷键见下表。浏览器保留键（`Cmd+1..9`、`Cmd+W`、`Cmd+T/N`、`Ctrl+Tab`、Linux 上的 `Alt+1..8`）网页无法覆盖。下表是**候选**：执行会话按 2.10 核对冲突后定稿，写进 `docs/keyboard.md`。每个动作同时在 `Cmd/Ctrl+K` 命令中心提供，快捷键不是唯一入口。

| 动作          | 候选                                                             |
| ------------- | ---------------------------------------------------------------- |
| 聚焦第 N 列   | Mac `Ctrl+1..4`；其他平台 `Alt+1..4`（Linux 冲突时改用其他组合） |
| 聚焦左/右列   | `Ctrl+Alt+[` / `]`                                               |
| 拆分          | `Cmd/Ctrl+\`                                                     |
| 关闭页签      | Mac `Ctrl+W`；其他 `Alt+W`                                       |
| 上/下一个页签 | `Ctrl+Alt+PageUp/PageDown` 或 `Alt+[` / `]`                      |
| 固定预览页签  | 命令中心                                                         |
| 移到相邻列    | `Ctrl+Alt+← / →`（已定）                                         |

### 1.6 同一笔记多处打开、撤销、删除

- 一个浏览器标签页里只有一份撤销历史（ADR 0064 不变）：`Cmd/Ctrl+Z` 撤销最近一次写操作，不管它发生在哪一列。撤销后回到该操作所在的列和页签；那个页签已关闭时，在活动列打开。
- 跨列移动或复制 = 一步撤销，两列同时恢复。
- 其他标签页、设备或 agent 的外部写入仍会清空撤销历史（ADR 0064）。同一标签页内不同列的写入不算外部写入。
- 删除笔记（或删除某页签正在缩放的节点）时，关闭指向它及其子孙的页签。

### 1.7 URL 与浏览器历史

- `/` 显示工作台。URL 反映**活动页签**：缩放根为 null 时是 `/`，否则是 `/$nodeId`，加该页签的 `?q=`。
- 在活动页签里缩放：`push`（与现在相同）。切换页签或列：`replace`，不往浏览器历史里塞记录。
- 浏览器后退或前进（`popstate`）到 `/$X`：
  1. X 在活动页签的后退栈里：该页签后退；
  2. 否则，X 已在某个页签打开：聚焦那个页签；
  3. 否则：活动页签缩放到 X。
- 深链接 `/$nodeId` 进来：已有页签打开该节点就聚焦它，否则在活动列新开固定页签。`/today?focus=last` 照此打开当天的 Daily 节点，并把光标放到最后一行。
- `settings`、`admin.*`、`privacy`、`terms`、`reset-password` 仍是独立整页路由，不进工作台。

### 1.8 布局持久化（仅本机）

- localStorage 键 `dotflowy:workbench-layout:v1:<userId>`，按账号区分，同一设备的不同账号互不影响。
- 内容：列（id、宽度比例、页签列表、活动页签）、活动列、侧栏开合与宽度。页签只存 id、缩放节点 id、是否预览、`q`；不存前进/后退栈。
- 读写都包 try/catch；读不到或版本不对时，用默认布局（一列，打开"全部大纲"）。
- 恢复时，等节点同步就绪后，丢弃指向已不存在节点的页签。

### 1.9 移动端（< 768px，与 ADR 0066 同一断点）

- 只有一列。页签显示成标题栏下拉或横向滚动的标签条，侧栏是抽屉（ADR 0066 的 drawer）。
- 没有跨列拖拽；跨笔记搬运用"移动到…"选择器（已打开页签排在最前）。
- 桌面端保存的多列布局在移动端只显示活动列，不改写本机布局。

### 1.10 与 Agent 协作的约定

- 约定一个名为 **Agent** 的文件夹：agent 通过 MCP 新建的笔记默认放进去。人从里面把内容拖到自己的笔记里。
- 节点上已有 `origin`（MCP 写入时记录客户端名），界面上现有的来源标记照旧。
- library 是 kv 侧集合，不实时推送（重新聚焦时对账）。agent 新建的顶层节点会通过节点同步立刻出现在"未归档"，library 刷新后归位。是否加轮询由 P8 决定。

### 1.11 不做

竖向拆分、网格布局、浮动窗口、思维导图、白板、笔记间嵌入、跨设备同步布局、文件夹级权限或分享。

---

## 2. 技术方案

行号以分叉点 `ed29647` 为准，仅供定位；以实际代码为准。

### 2.1 现状：哪些东西默认只有一个编辑器

| 位置                                 | 单例                                                                                                                                                                                                                                                                                     |
| ------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/data/view-state.ts:28-30`       | 模块级 `rootId`、`isHidden`、`filter`；getter 在 35/41/51 行；由 `useSyncViewState`（62，OutlineEditor:308 调用）和 `useSyncViewFilter`（74，OutlineEditor:636 调用）写入                                                                                                                |
| `src/components/OutlineEditor.tsx`   | `Mod+Z`/`Mod+Shift+Z` 热键（1197/1205）、`Mod+,` 缩小（1378）、`setNodeActionBridge`（593）、`setVirtualNav`（870）、`installLiteralPasteArm`（313）、用 `document` 查筛选输入框（710）、`useWindowVirtualizer`（809）、`scrollMargin` 依赖 `window.scrollY`（798）、粘性标题（900）     |
| 缩放                                 | `navigateZoom`（OutlineEditor:1340）通过路由跳转，用 `state.pivotId` 和 `viewTransition`；`routes/$nodeId.tsx:18` 以 `key={nodeId}` 重新挂载编辑器；`routes/index.tsx:14` 传 `rootId={null}`。文档写明 "`rootId` is route-owned"（AGENTS.md、`docs/architecture.md:87`）                 |
| `src/components/use-drag-reorder.ts` | 每个编辑器各自在 `document` 上挂 pointer 监听（528-530），5px 阈值；`buildRows`（193）、`project`（285）用 `elementFromPoint` 加插件落点，再用虚拟列表几何；层级由指针 x 加 0.4 缩进阻尼决定（369-379）；`onMove(grabbedKey, parent, after)`（480）；自动滚动用 `window.scrollBy`（442） |
| `src/data/history.ts`                | 每个浏览器标签页一个全局撤销栈（79-80，上限 100）；`capture` 对整份大纲做快照，所以一个动作 capture 一次 = 一步撤销；`HistoryLocation` 只有 `rootId`（10）；撤销恢复位置时改 URL（`history-restore.tsx:410-431`）                                                                        |
| 移动对话框                           | `openMoveDialog(ids, mode)`（`move-dialog-opener.ts:6`），"Go" 跳转写死为路由（`move-dialog.tsx:208, 272`）                                                                                                                                                                              |
| 读 view getter 的事件期代码          | OutlineEditor、use-drag-reorder、`selection-state.ts`、`selection-mode.tsx`、`focus-key.ts`、`markdown-paste.ts`、`token-kit.ts`、`link-keymap.ts`、`history-restore.tsx`；需要知道"活动列"的：`command-center.ts`、`header-more-menu.tsx`、`quick-add.tsx`                              |

可以保持全局的：`getTreeIndex()`（`tree-store.ts:455`），树索引本来就是全局的。每行的 `useBulletKeymap` 绑在元素上，不受影响。`Cmd+K` 的窗口级捕获（`node-switcher.tsx:199`）已经用 `closest('[data-node-id]')`，只需再解析所属列。

### 2.2 PaneContext 与工作台状态

- `src/workbench/`（新目录）放工作台状态：模块级 store + `useSyncExternalStore`。存列、页签、活动列 id、每个页签的缩放根和 `q`、前进/后退栈。
- `PaneContext`（React context）向编辑器提供 `paneId`、当前页签状态和方法（`zoomTo`、`setFilter`、`back`、`forward`）。
- 编辑器根元素加 `data-pane-id`。事件期代码从事件目标 `closest('[data-pane-id]')` 解析所属列，不再读"唯一的"全局值。
- `view-state.ts`：模块变量改为按 `paneId` 存的 map。原 getter（`getViewRootId()` 等）返回**活动列**的值，保证老调用点不改也能工作；另加 `getViewRootIdFor(paneId)` 等按列读取的版本。逐个检查 2.1 表中的读者，能拿到元素的改为按元素解析。
- 编辑器级单例（撤销热键、`Mod+,`、node action bridge、virtual nav、粘贴开关、筛选输入框查找）提到工作台宿主层：要么只注册一次，要么按 `paneId` 注册、由宿主分发给活动列。不能让每列各注册一份，导致一次按键触发 N 次。

### 2.3 每列独立滚动

- `useWindowVirtualizer` 改为 `useVirtualizer` + 列自己的滚动元素；`scrollMargin`、粘性标题、`scrollIntoView`、拖拽自动滚动都改为相对该元素。
- 单列时外观应与现在一致。手机上从页面滚动改成元素滚动，可能影响地址栏收起和回弹，P9 检查；问题严重时，移动端可以保留窗口滚动，结论写进 ADR。
- 这会修订 ADR 0019 的"窗口虚拟化"前提。现有 perf guard 测试（计数型）必须保持通过。

### 2.4 缩放与 URL 解耦

- `navigateZoom` 改为调用 `pane.zoomTo(id)`，由工作台把活动页签同步到 URL（规则见 1.7）。
- 编辑器不再以路由的 `nodeId` 作 key，改为 `key={tab.id + ':' + viewRootId}`，保留"每次缩放重新挂载"的语义（`$nodeId.tsx` 注释里的 view-transition 问题依赖它）。
- View transition：多列时只给活动列设置 `view-transition-name`。同一节点在两列打开会产生重名，浏览器遇到重名会直接放弃整个过渡。
- `?q=` 筛选变成页签状态，URL 只映射活动页签的筛选。`focus=last` 变成一次性的页签意图。
- 需要同步修改 AGENTS.md 和 `docs/architecture.md` 里 "`rootId` is route-owned" 的说法。

### 2.5 Library：文件夹与笔记的存储

- 新 kv 侧集合 `library`，加进 `worker/index.ts` 的 `KV_COLLECTIONS`。行结构：

  ```ts
  { id: string; type: "folder" | "note"; parentId: string | null; // 父文件夹 id
    rank: string;            // 分数排序键，移动只写一行
    title?: string;          // 仅 folder
    rootNodeId?: string }    // 仅 note：对应的顶层节点
  ```

- 笔记标题不存 kv，直接读根节点文本，只有一个来源。
- 不改 `Node` schema，不加 DO migration（AGENTS.md：没有客户端数据迁移）。备份已经覆盖 kv（`worker/backup.ts:29-47`），P4 确认 `library` 包含在内。
- 客户端照 `src/data/saved-queries.ts` 的写法：`queryCollectionOptions` + `kv-api`，读取用 `subscribeChanges` + `useSyncExternalStore`（`useLiveQuery` 会让 `/` 预渲染失败，见 `docs/architecture.md`）。纯逻辑（建树、rank 取中点、计算"未归档"）放 `library-core.ts`，配单测。
- 请求体用 Effect Schema 解码（AGENTS.md 规定）。
- 第一个版本里，library 变更不进撤销历史（ADR 0064：侧数据不撤销）。删除笔记靠"登记行在、节点不在就隐藏"来配合节点撤销（见 1.2）。

### 2.6 跨列拖拽控制器

- 把拖拽状态从每个编辑器的 hook 提到模块级 `DragController`，任何时刻只有一个拖拽。
- 命中检测：`elementFromPoint` → `closest('[data-pane-id]')` 找到目标列，再用那一列的行几何和虚拟列表算落点和层级，规则与列内拖拽一致。
- 页签、页签栏、侧栏笔记、侧栏文件夹作为外部落点注册；先看现有的 `ExternalDropTargetSpec`（`plugins/types.ts:556`、`registry.ts:474`）能否复用。
- 自动滚动：滚动指针下方那一列的元素，不再滚 `window`。
- 放下时读 `altKey`；拖拽过程中 Alt 状态变化时，实时切换"复制"标记。
- 移动走现有 `moveNodes` 结构写入；一次放下只 `capture` 一次。

### 2.7 深拷贝

- 新 mutation（如 `copySubtrees(ids, parentId, afterId)`，放 `src/data/mutations.ts`），一次原子 `POST /api/nodes {ops}`（ADR 0009）。现在只有 `mirrorManyNodes`（`mutations.ts:294`），没有复制。
- 字段：保留 `text`、`kind`、`isTask`、`completed`、`collapsed`、`mirrorOf`（镜像的副本仍是同一源的镜像）；`locked`、`bookmarkedAt` 置空，`origin = null`，新 id，`createdAt/updatedAt` 取当前时间。文本里的节点链接保持原样，仍指向原目标。
- 纯函数部分（id 重映射、`prevSiblingId` 链）单独导出，配单测。

### 2.8 撤销位置

- `HistoryLocation` 加 `paneId?`、`tabId?`。恢复时页签还在就聚焦它并缩放到 `rootId`，否则在活动列打开。
- 不改快照式撤销本身，也不改 ADR 0064 的外部写入规则。

### 2.9 MCP

- 新工具：`list_library`（文件夹/笔记树，带标题和 `rootNodeId`）、`create_folder`、`create_note`（文件夹、标题，可选初始子树，复用 `add_subtree` 的输入格式）、`move_note`。
- `OutlineStore`（`worker/mcp-tools.ts:75-90`）没有 kv 写接口，需要加 `upsertKv`/`listKv`。
- 更新 `docs/mcp.md`。
- 上游 issue #330（MCP 中含 patch/delete 的写入在 Lunora 同步账号上报 -32603）：Lunora 退役后可能已经不存在。P0 冒烟测试时验证，能复现再修。

### 2.10 快捷键核对方法

对每个候选组合，逐条确认：

1. 不在 `docs/keyboard.md` 里，也不在 `src/` 下任何 keymap 或热键注册里（按仓库实际写法搜索，如 `useHotkey`、`Mod+`、`altKey`）；
2. 不是 Chrome/Safari/Firefox 的保留键；
3. 在 Mac 上不是常见系统快捷键，也不是 Cocoa 文本编辑键（`Ctrl+A/E/K/Y/H/D/F/B/N/P`）；
4. `Alt/Option` 组合在 Mac 上会输入特殊字符，处理时按 `event.code` 判断并 `preventDefault`。

e2e 里按 `ControlOrMeta+…` 写，不写裸 `Meta+`。

---

## 3. 分期

每期一个分支 `workbench/pN-<slug>`，从最新 `main` 切出。做完开 PR 到 `Rajahn/dotflowy` 的 `main`，全部门槛通过、`/code-review` 自查后合并，再开下一期。合并失败的处理见 4.2。

每期都要：

- 加一个根 changeset。行为变化写正常条目，纯重构用 `bunx changeset --empty`；交互式命令不可用时，照 `.changeset/README.md` 的格式手写文件。
- 更新 `docs/workbench/STATUS.md`。
- 修改的路径、命令或行为若让 AGENTS.md、README、`docs/*` 失实，同一个 PR 里改掉。

### P0 环境与基线

- 确认 `bun --version` 是 1.4.2（`package.json` 的 `packageManager`），然后 `bun install --frozen-lockfile`，`bunx playwright install --with-deps chromium`。
- 在未改动的 `main` 上跑全部门槛（第 5 节），把结果写进 STATUS 的基线表（包括已知 flaky）。
- `bun run setup` → 后台启动 `bun run cf:dev`（:8787）→ `bun run seed:user` → `bun run comp:dev-plan` → `bun run mint:mcp-token`。用拿到的 bearer 对 `POST http://localhost:8787/mcp` 做冒烟：`tools/list`、`add_node`、`update_node`、`move_nodes`、`delete_node`，记录 #330 是否复现。token 不写进任何文件或日志。
- 产出：一个只改 STATUS.md + 空 changeset 的 PR。

### P1 PaneContext（行为不变）

- 内容：2.2 全部。工作台 store 先只有一列一页签，界面不变。
- 验收：
  - 现有单测和 e2e 全绿，不修改任何现有 spec 的断言；
  - 新增 view-state 按列读写、宿主分发热键的单测；
  - PR 描述列出 2.1 表中每个单例的去向（改成按列 / 提到宿主 / 保持全局及理由）。

### P2 每列独立滚动

- 内容：2.3。
- 验收：
  - perf guard 和全部 e2e 通过；
  - 新增一条 e2e 旅程（或扩展现有长大纲旅程）：上千节点的大纲里滚动、跨虚拟窗口边界上下移动光标、拖拽时自动滚动。

### P3 缩放与 URL 解耦、页签模型、撤销位置

- 内容：2.4、2.8，页签数据模型和 1.7 的 URL 规则。界面仍是一列，可以先不显示页签栏。
- 验收：
  - 现有缩放、前进后退、深链接、`/today?focus=last`、筛选 `?q=` 的 e2e 不改断言通过；
  - URL 同步规则（1.7 的三条）写成纯函数，配表驱动单测。
- ADR（英文，YAML frontmatter 同 0068）：pane-owned view root 与工作台 URL 规则。它修订 "rootId is route-owned"，以及 ADR 0019 和 0064 的相关部分。

### P4 Library 与侧栏

- 内容：2.5 和 1.2。`/` 变成"侧栏 + 单列编辑器"；单击笔记 = 活动页签缩放到笔记根节点（预览规则在 P5 实现）。
- 验收：
  - `library-core` 单测：建树、rank、未归档计算、隐藏缺失节点；
  - e2e 旅程：新建文件夹 → 新建笔记 → 重命名 → 拖进另一个文件夹 → "未归档"显示顶层节点并能登记 → 删除空文件夹。e2e fixture 的 `/api/kv` mock 支持 `library`。
- ADR：library 作为 kv 侧集合、"笔记 = 顶层节点"、未归档规则。

### P5 多列布局与页签界面

- 内容：1.3、1.8、1.5 中的工作台快捷键（按 2.10 定稿），命令中心命令，`docs/keyboard.md`。
- 验收（尽量合并成少数几条旅程，符合 CONTRIBUTING 的 Playwright 规则）：
  - 预览页签替换与固定的各种情况；
  - 拆分到 4 列后禁用；关闭最后一个页签会关闭列；
  - 刷新后布局恢复；
  - 两列打开同一笔记，在 A 列打字，B 列同步显示；
  - 列宽拖动与双击复位；
  - 窄屏横向滚动。
- 视觉状态矩阵：活动/非活动列、预览/固定页签、拖拽悬停、空状态，各截一张 Playwright 截图检查。
- ADR：工作台布局与页签规则（或并入 P3 的 ADR，按实际情况决定）。

### P6 跨列拖拽与复制

- 内容：2.6、2.7、1.4 整张表。
- 验收：
  - 深拷贝纯函数单测；
  - e2e 旅程：A 列节点拖到 B 列指定层级 → 一次撤销后两列都恢复；`Alt` 拖拽复制；悬停页签切换；拖到页签栏新开页签；拖到侧栏笔记和文件夹；`Esc` 取消；
  - 用 Playwright `mouse.move(..., { steps })` 模拟拖动，不用固定等待。
- ADR：跨列拖拽与复制语义。

### P7 键盘移动、移动到…、撤销回位

- 内容：1.5 的 `Ctrl+Alt+→/←`，"移动到…"里的已打开页签，2.8 的撤销回到原列原页签。
- 验收：
  - e2e：键盘跨列移动后焦点落在源列下一个节点；撤销后回到原列；
  - "上次聚焦位置"的规则有单测。

### P8 MCP

- 内容：2.9 和 1.10 的 Agent 文件夹约定。按需修 #330。
- 验收：
  - worker 单测覆盖新工具的 schema 和存储读写；
  - 本地 `cf:dev` 上用 bearer 跑一遍：建文件夹 → 建笔记 → 列出 → 移动；
  - 浏览器里能看到结果（刷新或聚焦后）。

### P9 移动端、文档、收尾

- 内容：1.9；检查 2.3 的移动端滚动；AGENTS.md、README、`docs/architecture.md`（含 task map）、`docs/keyboard.md`、`docs/mcp.md` 全部与实现一致。
- 最后用 `/code-review` 审一遍从分叉点到当前 main 的完整 diff。
- 验收：
  - 375px 视口 e2e：抽屉侧栏、页签切换、"移动到…"；
  - 跨过 767px/768px 边界时布局正确切换；
  - STATUS.md 写最终总结。

---

## 4. 执行会话规则

### 4.1 授权与边界

- 仓库所有者已为本方案豁免 `/grill-with-docs`。按 AGENTS.md，改为人工对照相关 ADR 检查设计。发现与已有 ADR 冲突、且本方案没有覆盖的点，记到 STATUS.md 的"需要决定"，跳过该点继续做其他部分。
- 可以自行调用 `/code-review`、`/security-review`、`/domain-modeling`、`/ft-create-concise-pr`。
- **不碰**：billing/Stripe、auth 与注册门槛、`landing/`、`wrangler.jsonc` 的路由和部署配置、Lunora 保留导出、邮件、`cli/`（MCP 文档除外）、iOS Shortcut。
- 不访问生产环境（`dotflowy.com`、`app.dotflowy.com`）；不往上游 `cameronapak/dotflowy` 提 PR、issue 或评论；不合并上游。
- 不提交任何密钥。`.dev.vars` 已在 `.gitignore` 里。MCP bearer 只放在环境变量里。
- 不推 tag，不删远程分支，不 force push 到 `main`。

### 4.2 GitHub 操作

- 代理只放行 REST，`gh pr`/`gh issue` 用的 GraphQL 会被拒。用 `gh api`：
  - 开 PR：`gh api repos/Rajahn/dotflowy/pulls -f title=... -f head=<branch> -f base=main -f body=...`
  - 合并：`gh api -X PUT repos/Rajahn/dotflowy/pulls/<n>/merge -f merge_method=squash`
- `gh` 不可用或合并被拒时，改成**分支叠加**：下一期从上一期分支切出，PR 的 base 仍是 `main`，把 PR 链接写进 STATUS，由所有者按顺序合并。
- fork 的 GitHub Actions 目前没有启用，PR 上不会有 CI。本地门槛就是合并标准。
- 进度和待决事项只写 STATUS.md，不用 GitHub issue。

### 4.3 节奏与停止

- 每期结束更新 STATUS.md：完成内容、PR 链接、门槛结果、偏离方案的地方及原因、下一步。上下文被压缩或换新会话时，从 STATUS 的"下一步"继续。
- 一项卡住时记进 STATUS，继续做不依赖它的部分。
- 全部完成，或者只剩被阻塞的项时，停止。最后一条消息给出总结和 STATUS 链接。不留后台进程：`cf:dev` 用完后关闭。

### 4.4 环境故障

- `bun install` 出现网络或 TLS 错误时：
  1. 确认 `HTTPS_PROXY` 已导出；
  2. 试 `NODE_EXTRA_CA_CERTS=/etc/ssl/certs/ca-certificates.crt bun install --frozen-lockfile`；
  3. 仍失败就记进 STATUS 并停止。不要换成 npm 装依赖：`bun.lock` 是唯一锁文件，换包管理器会导致版本漂移。
- Chromium 装不上时，P0–P2 可以只靠单测和类型检查推进，但 PR 要注明 e2e 未跑。P3 及以后的界面期没有 e2e 不合并，记进 STATUS 等待所有者处理网络。

---

## 5. 门槛（每期合并前全部通过）

```sh
bun run fmt:check
bun run lint
bun run typecheck
bun run typecheck:worker
bun run typecheck:test
bun run test
bun run check:docs
bun run test:e2e          # 单个 spec 调试用 bun run test:e2e:app e2e/<x>.spec.ts --workers=1
bun run check:changeset
```

另外：可观察的行为变化要么在 `bun run cf:dev` 里实际跑过，要么有 e2e 旅程覆盖（AGENTS.md）。

e2e 约定：

- 新 spec 名以 `workbench-` 开头；
- 多列场景下，所有定位限定在 `[data-pane-id="..."]` 内，因为同一节点出现在两列时 `li[data-node-id]` 不再唯一；
- 单列默认布局要让现有 spec 的选择器保持唯一。

---

## 6. 主要风险（逐期自查）

1. 漏改的单例读者在错误的列上执行（复制粘贴、筛选、选区、焦点）。P1 用 2.1 表逐项打勾。
2. 从窗口虚拟化改成元素虚拟化：滚动位置、粘性标题、移动端行为回退。
3. 同一节点在两列打开时，`document.querySelector('[data-node-id=…]')`、`[data-history-key]` 之类全局查找变得有歧义。全部改为在 pane 根元素内查找。
4. 缩放和 URL 解耦：前进后退、view transition、深链接、`/today?focus=last`。
5. 热键在每列各注册一次，或一次拖拽 capture 多次，导致撤销步数不对。
6. 页签布局恢复时，指向已删除节点的页签导致崩溃或空白页。
