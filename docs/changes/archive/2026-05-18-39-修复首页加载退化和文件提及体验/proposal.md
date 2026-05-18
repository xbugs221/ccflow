# 39-修复首页加载退化和文件提及体验

## 问题

最近两个性能相关变更分别优化 Provider 项目发现和聊天历史渲染，但它们也暴露了三个核心可用性回归：

```text
cbw 启动和日常使用
├── 首页依赖 /api/projects
│   └── Provider 索引一旦变慢，用户会卡在进入应用前
├── 聊天输入框 @文件
│   ├── 大仓库文件太多，靠滚动选择不可用
│   └── 用户需要搜索和树形导航两种找文件方式
└── 会话卡片消息数
    └── 懒加载后概览 messageCount 可能是未知，却被显示成 0 条消息
```

本机检查 `http://localhost:4001/` 时，页面当前可以进入，`/api/projects` 约 130ms 返回，但响应体已经接近 1.5MB，并且 provider 会话概览中出现 `messageCount: 0`。这说明当前状态可能因缓存或数据规模暂时可用，但设计上仍然把未知消息数和真实 0 混在一起，也缺少 Provider 索引慢速或失败时的首页降级保证。

## 目标

- 首页必须优先可进入；Provider 全量索引慢、失败或数据量大时，不能阻塞基本项目列表。
- Provider-only 自动发现保留，但首页最多展示最近 50 个 Provider-only 项目，避免历史数据把主页撑爆。
- 会话概览中的未知消息数不得显示为 `0` 或 `0 条消息`；只有真实计数才显示。
- `@文件`按钮打开的选择器默认展示当前项目根目录文件树，允许用户自由展开目录导航。
- 文件选择器必须支持模糊搜索，用户可以通过文件名、路径片段、缩写或多 token 搜索快速定位文件。
- 文件选择和搜索必须把选中文件插入当前输入框，保持键盘和鼠标操作可用。

## 范围

```text
cbw
├── server/projects.ts
│   ├── /api/projects 返回路径拆分为可用概览和后台 Provider 索引刷新
│   ├── Provider 索引设置耗时边界和失败降级
│   ├── Provider-only 项目按最近活跃排序并限制 50 个
│   └── messageCount 使用 unknown/null 语义表达未知
├── src/components/main-content/view/subcomponents
│   └── 项目主页会话卡片隐藏未知消息数
├── src/components/sidebar
│   └── 侧边栏会话卡片隐藏未知消息数
├── src/components/chat/hooks/useFileMentions.tsx
│   ├── 保留当前项目根目录文件树
│   ├── 支持搜索结果和树形浏览状态
│   └── 选择文件后插入输入框
├── src/components/chat/view/subcomponents/ChatComposer.tsx
│   └── 将 @文件下拉改为搜索 + 文件树选择器
└── tests
    ├── 首页大历史可进入和降级
    ├── Provider-only 50 项上限
    ├── 未知消息数不显示 0
    ├── @文件模糊搜索
    └── @文件文件树导航
```

## 非目标

- 不重做首页视觉样式。
- 不在首页精确统计全部历史消息数量。
- 不新增全仓库全文索引服务。
- 不迁移 Codex、Pi 或 OpenCode 的历史格式。
- 不扩大聊天历史虚拟滚动的实现范围。
- 不改变文件内容上传或附件发送语义。

## 测试策略

执行阶段应在本提案 `tests/` 目录写真实测试代码，再在归档时迁移到根 `tests/`：

- Server 测试构造大量 Provider 历史，证明 `/api/projects` 不因索引慢或失败而不可用。
- Server 测试构造超过 50 个 Provider-only 项目，证明首页只返回最近 50 个，同时保留手动项目。
- Browser/spec 测试断言 `messageCount` 未知时项目主页和侧边栏都不显示 `0 条消息`。
- Browser/spec 测试断言 `@文件` 搜索支持模糊命中，例如 `cmp msg pane` 能命中 `ChatMessagesPane.tsx`。
- E2E 测试断言点击 `@文件` 后默认展示项目根文件树，可展开目录并选择文件插入输入框。

## 开放问题

- Provider 索引耗时边界先定多少毫秒，需要在执行阶段结合现有请求生命周期确认。建议先以首页首屏 3 秒内可进入为业务验收上限。
- 文件树是否需要按目录懒加载由执行阶段按现有 `/api/projects/:project/files` 能力决定；若当前接口只返回整棵树，本提案只要求前端交互可用，不强制新增后端目录分页接口。
