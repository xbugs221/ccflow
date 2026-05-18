# 设计：修复首页加载退化和文件提及体验

## 现状判断

`/api/projects` 是首页进入应用的关键路径。最近 Provider 发现改成轻量索引后，避免了很多历史 transcript 深读，但首页仍然可能等待这些工作：

```text
/api/projects
├── manual project config
├── Codex index
├── Pi index
├── OpenCode SQLite/CLI index
├── provider-only project expansion
├── workflow metadata
├── session visibility annotation
└── routeIndex/config persistence
```

这些步骤里任何一个被真实历史规模拖慢，用户都会先看到“主页难进入”，而不是一个可用但仍在刷新的页面。

同时，Provider 概览现在用 `messageCount: 0` 表示“未深读，所以不知道”。UI 把这个值当成真实计数展示，用户会误以为会话没有消息。

`@文件`已有文件列表和搜索能力，但交互仍是线性列表。大仓库下用户需要两条路径：

```text
找文件
├── 我知道大概名字
│   └── fuzzy search
└── 我知道目录位置
    └── project root file tree
```

## 决策 1：首页项目概览必须可降级

`getProjects()` 应拆分“必须完成”和“可延迟完成”：

```text
must return
├── manual projects
├── cached projects if available
├── cheap provider index results within budget
└── minimal session overview

background / best effort
├── slow provider index refresh
├── provider-only project expansion
├── route index repair
└── expensive visibility/workflow reconciliation
```

Provider 索引慢或失败时，接口应返回可用概览，并记录日志或状态用于后续刷新。不能因为 OpenCode DB、Pi JSONL 或 Codex session tree 慢而让首页一直不可用。

## 决策 2：Provider-only 项目限制 50 个

用户确认保留 Provider-only 自动发现，但首页只保留最近 50 个 Provider-only 项目：

```text
final projects
├── manual/configured projects        unlimited
└── provider-only projects            top 50 by lastActivity
```

排序依据优先用 session `lastActivity`，缺失时用 `createdAt` 或文件 mtime。这个限制只约束首页自动展示，不删除历史，也不影响用户通过具体会话链接或未来搜索入口进入。

## 决策 3：未知消息数不能显示成 0

Provider header index 没有真实消息数量时，后端应表达为未知：

```text
messageCount: null
messageCountKnown: false
```

或者等价地省略 `messageCount`，但前端必须能区分：

```text
0              真实 0 条，可显示或隐藏
null/undefined 未知，不显示任何消息数
positive       真实计数，显示
```

本次按用户确认，未知消息数在卡片上完全隐藏，不显示“未知”文案，减少误导和噪音。

## 决策 4：文件选择器采用搜索 + 树形导航

`@文件`按钮打开一个项目文件选择器，默认展示当前项目根目录：

```text
FileMentionPicker
├── search input
├── when query exists
│   └── fuzzy result list
└── when query empty
    └── project root tree
        ├── expandable directories
        └── selectable files
```

搜索结果继续使用已有 `filterMentionableFiles()`，并补足真实交互测试。文件树状态保留展开目录集合，用户可以自由导航。选择文件后使用现有插入逻辑写入输入框，并关闭选择器。

如果当前文件接口返回完整树，则前端先在本地构建树和扁平索引。若真实大仓库加载整棵树过慢，执行阶段可把目录懒加载作为同一目标下的后端小改，但不引入全局文件索引服务。

## 风险

- 风险：首页降级让部分 Provider-only 项目暂时不可见。
  - 处理：手动项目优先，Provider-only 限制为最近 50 个，并在后续刷新补齐。

- 风险：隐藏未知消息数后，用户看不到某些会话规模。
  - 处理：这是有意取舍；错误的 0 比不显示更误导。进入会话后仍可加载真实消息。

- 风险：文件树一次性渲染太多节点。
  - 处理：默认只展开根层；目录展开后才渲染子节点，搜索结果限制数量。

- 风险：搜索和树形导航状态互相干扰。
  - 处理：有 query 时展示搜索结果，无 query 时展示树；选择文件共用同一 `selectFile`。

## 测试设计

- `tests/server/...projects-degraded-home.test.ts`：模拟 Provider 索引超时或抛错，断言 `getProjects()` 仍返回手动项目和已有缓存。
- `tests/server/...provider-only-project-limit.test.ts`：构造超过 50 个 Provider-only 项目，断言返回最近 50 个且不影响手动项目。
- `tests/spec/...session-message-count-unknown.spec.ts`：构造 `messageCount: null/undefined` 的会话，断言项目主页和侧边栏不出现 `0 条消息`。
- `tests/spec/...chat-file-mention-fuzzy.spec.ts`：验证多 token、缩写、路径片段能命中文件。
- `tests/e2e/...chat-file-tree-picker.spec.ts`：在真实页面点击 `@文件`，默认看到项目根目录，展开目录并选择文件后输入框包含路径。
