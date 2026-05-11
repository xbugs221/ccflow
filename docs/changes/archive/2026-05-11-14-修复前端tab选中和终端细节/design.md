## 总体设计

本变更把工作区主内容和辅助 dock 作为两类状态处理：

```text
主内容状态
  `-- chat：项目概览、会话、workflow 会话内容

辅助 dock 状态
  +-- rightDock：files 或 git
  `-- bottomDock：terminal
```

桌面端点击文件、终端、Git 时，只更新 dock 状态；会话内容继续留在中间区域。移动端没有并排 dock，仍沿用单视图切换。

## 关键决策

### 桌面默认只选中会话 tab

桌面工作区应把 `chat` 作为唯一主选中态。文件、终端、Git 按钮可以有 hover 或 dock 打开状态，但不得和会话 tab 同时表现为主选中。

执行阶段应避免从旧 `localStorage.activeTab` 恢复 `files`、`shell`、`git` 作为桌面默认主内容。旧值只允许迁移到 dock 展开状态，主内容仍回到 `chat`。

### dock 按钮只控制 dock，不切空会话区

现有问题来自 `activeTab === 'files' | 'shell' | 'git'` 时，中间聊天区域被隐藏。执行阶段需要让桌面端点击 dock 按钮保持或恢复 `activeTab='chat'`，同时更新 dock 布局。

```text
点击 tab-files
  -> rightDock.activePanel = files
  -> rightDock.collapsed = false
  -> activeTab 保持 chat

点击 tab-shell
  -> bottomDock.activePanel = terminal
  -> bottomDock.collapsed = false
  -> activeTab 保持 chat
```

再次点击已经打开的 dock 按钮可以继续沿用当前“收起对应 dock”的行为。

### 普通页面不自动刷新

普通项目页和会话页不得触发整页 reload，也不得每隔几秒刷新项目列表。执行阶段需要审计：

- `window.location.reload()` 的兜底路径；
- `setInterval` 调用 `api.projects()` 或 workflow API 的路径；
- WebSocket 重连是否误触发项目状态刷新；
- 路由解析时是否因为项目列表更新把会话状态清空。

允许保留的刷新必须有明确业务边界，例如运行中的 workflow detail 状态刷新，且不应影响普通会话页。

### 底部终端使用嵌入式模式

底部 dock 已经有自己的 pane header，因此内部 ShellHeader 是重复控制。执行阶段应让 bottom dock 的 `StandaloneShell` 或 `Shell` 以嵌入式模式运行：

- 不显示连接状态、“断开连接”、“重启”这行；
- 仍保留终端画布和必要登录 URL 提示；
- 删除终端时通过组件卸载或显式关闭清理对应 WebSocket。

### 终端新建和删除采用本地实例管理

终端实例先做项目内本地状态，不引入后端持久化。

```text
terminalInstances = [
  { id: "t1", title: "终端 1" },
  { id: "t2", title: "终端 2" }
]
activeTerminalId = "t2"
```

每个实例对应一个独立 `StandaloneShell`。为避免切换终端导致连接丢失，优先保持已创建终端组件挂载，只隐藏非活动终端；如果执行阶段发现 xterm 在隐藏容器下尺寸不稳定，应在切回活动终端时触发 fit 或采用更简单的活动实例重建策略，并用测试固定实际行为。

删除当前终端时关闭该实例并选中相邻终端。删除最后一个终端后可以保留空状态并展示“新建”，也可以立即补一个新默认终端；验收重点是用户能删除当前终端且不会影响会话区。

### 文件树隐藏重复标题

外层 dock panel header 已经提供“文件”标题。文件树内部工具栏应移除重复标题，保留操作按钮和搜索框。若移动端仍需要标题，可给 `FileTreeHeader` 增加上下文参数；默认以桌面 dock 不重复为准。

## 风险与处理

- **旧 activeTab 持久化**：用户本地可能存有 `shell` 或 `files`。读取时必须归一到 `chat`，dock 状态由 workspace layout 负责恢复。
- **终端删除清理**：如果组件卸载没有关闭 WebSocket，需要补显式 cleanup，避免后台 PTY 残留。
- **隐藏终端尺寸**：多个终端保活时，隐藏实例切回可能需要重新 fit。
- **刷新误判**：运行中 workflow 的状态刷新是业务需要，普通会话页的自动刷新才是本次清理对象。

## 测试策略

执行阶段应新增真实 Playwright 测试，放在本提案 `tests/` 后同步到根 `tests/`：

- 打开真实 fixture 会话路由，断言只有会话 tab 是选中态。
- 点击文件、终端、Git 按钮后，聊天区仍可见，dock 面板按预期打开或切换。
- 等待数秒，断言普通会话页没有整页 reload，也没有每秒 `/api/projects` 轮询。
- 底部终端 dock 不显示“断开连接/断开链接”和“重启”控制行，终端画布仍存在。
- 文件 dock 内部不重复显示“文件”标题，搜索、刷新、新建、上传等操作仍可见。
- 点击终端“新建”出现第二个终端实例；点击“删除”关闭当前终端实例，且会话区仍可见。
