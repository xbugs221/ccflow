# 设计：优化聊天历史虚拟滚动和懒渲染

## 现状

聊天页当前已经有分页读取：

```text
initial load
  limit = 100
  offset = 0

scroll near top
  limit = 100
  offset = loaded count
  prepend older messages
```

但渲染层仍是普通数组 map。每次加载旧历史后，可见消息数量会继续增长，页面上的真实消息节点也随之增长。消息节点内部还可能包含 Markdown 解析、Prism 高亮、diff 计算、JSON 格式化、工具结果渲染和子任务时间线。

折叠工具卡使用 `<details>`，但 children 在 React 渲染阶段仍会创建。折叠只减少视觉展示，不减少创建 React 子树和计算内容的成本。

## 设计原则

```text
数据加载 != DOM 渲染

已加载消息可以很多
DOM 中消息必须少
重内容必须按需展开
滚动锚点必须稳定
```

本次优先解决主线程和 DOM 压力，不追求新的视觉样式。

## 技术方案

### 1. 引入 transcript 虚拟列表

聊天消息面板应从 `visibleMessages.map(...)` 改为虚拟列表渲染：

```text
all loaded messages
  -> virtual range
     ├── overscan before
     ├── viewport messages
     └── overscan after
        -> MessageComponent
```

虚拟列表需要支持：

- 动态高度消息。
- 初始滚动到底部。
- 上边界触发加载更早历史。
- 加载更早历史后保持当前锚点可见。
- 新消息追加时，底部跟随和用户上滑冻结逻辑保持现有语义。
- 根据 `messageKey` 或稳定 intrinsic key 维护 item identity。

优先使用成熟库。若仓库不希望增加依赖，则手写最小实现时必须限制范围：只处理本聊天容器、动态高度缓存、顶部 prepend 锚点、底部 follow 四个能力，不做通用抽象。

### 2. 拆分加载窗口和渲染窗口

当前的 `visibleMessageCount` 混合了承载两层含义：

```text
已加载旧消息数量
DOM 中可见消息数量
```

执行阶段应拆开：

```text
loadedMessages
  表示已从后端拿到、可被搜索/定位/合并的数据

virtualWindow
  表示当前 DOM 实际渲染的 item 范围
```

这样“加载全部”可以只改变 `loadedMessages`，不再让 DOM 变成全量渲染。

### 3. 工具卡折叠懒渲染

工具卡和子任务容器应默认只渲染摘要：

```text
collapsed
  summary row only
  no full Markdown
  no full diff
  no full child tool timeline
  no full JSON stringify for large output

expanded
  render actual children
```

`CollapsibleSection` 需要维护可控或本地 open 状态，并且只有 open 时才渲染 children。对运行中的工具，可以保留少量实时摘要，例如最后几行输出、当前命令或进度计数。

### 4. 大内容摘要化

对高成本内容设置阈值：

- 大代码块默认显示摘要和行数，展开后再执行语法高亮。
- 大 diff 默认显示文件名、增删行数和前若干行，展开后再计算或渲染完整 diff。
- 大工具输出默认截断摘要，展开后再渲染完整 Markdown 或 pre。
- 子任务容器默认显示完成数、错误数、当前工具，展开后才渲染完整 step 列表。

阈值必须服务业务体验，不做复杂配置。建议先用固定阈值，后续根据真实反馈调整。

### 5. 降低全量同步成本

执行阶段应审查这些路径：

```text
chatMessages change
  -> dedupeAdjacentChatMessages
  -> mergePersistedAndOptimisticMessages
  -> safeLocalStorage.setItem(JSON.stringify(...))
```

优化方向：

- 对历史 session 已由服务端持久化的消息，不必每次全量写入 localStorage。
- localStorage 只保存必要的本地草稿或最近少量未确认消息。
- 消息转换和去重尽量按增量处理，避免长会话每次追加都全量重算。

## 风险

- 动态高度虚拟列表容易出现滚动跳动。
  - 处理：以“当前可见第一条消息”为锚点，prepend 后按测量高度修正 scroll offset。
- 搜索跳转可能目标消息尚未加载。
  - 处理：保留逐页加载直到目标 messageKey 出现的逻辑，再交给虚拟列表 scrollToItem。
- 新消息到达和用户上滑冻结容易冲突。
  - 处理：继续以是否在底部、是否存在 frozen tail 为事实源；虚拟列表只负责显示范围。
- 工具卡懒渲染可能影响用户复制或查看历史细节。
  - 处理：摘要保留明确展开入口，展开后渲染完整内容。

## 测试

执行阶段应新增或更新这些真实测试：

- `tests/e2e/...chat-history-virtualization.spec.ts`：构造长会话，断言初始打开在最新消息，消息 DOM 数量有上限。
- `tests/e2e/...history-scroll-preservation.spec.ts`：扩展现有历史滚动测试，覆盖虚拟列表下上滑加载旧消息后锚点保持。
- `tests/spec/...chat-history-full-text-search.spec.ts`：更新搜索命中旧消息场景，覆盖未加载目标逐页加载并滚动定位。
- `tests/spec/...chat-tool-lazy-rendering.spec.ts`：验证折叠工具卡默认不渲染完整大输出，展开后再渲染。
- 必要时补充 node 层单测，覆盖消息窗口计算、稳定 key、加载窗口和渲染窗口拆分逻辑。
