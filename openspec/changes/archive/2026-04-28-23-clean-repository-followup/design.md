# Design: 精简代码库后续复核

## Current Findings

执行阶段确认：

- `openspec list` 显示 `21-workflow-w1` 为 Complete，`23-clean-repository-followup` 是独立后续复核变更。
- `git status --short` 只显示本 OpenSpec 变更未跟踪，没有生成物噪音。
- `planner-output.json`、`execution-manifest.json`、`verification-evidence.json`、`delivery-summary.md`、`.ccflow/`、`.playwright-cli/`、`test-results/`、`dist/`、`.tmp/`、`tests/spec/.tmp/`、`node_modules/` 和 `server/database/auth.db` 均为 ignored 本地输出。
- `git ls-files` 未发现 planner、execution、verification、delivery、Playwright、缓存、构建或本地数据库输出被跟踪。
- `package.json` 已声明 `packageManager: pnpm@10.33.0`，当前只存在 `pnpm-lock.yaml`。
- `21-workflow-w1/tasks.md` 已勾选 package manager、生成物边界、源码结构、逻辑拆分和验证任务；当前事实与其完成状态一致。唯一需要解释的是生成物文件仍可在本地存在，但已经被 ignore 且不进入 git。
- `docs/workflow-state-design.md` 的 `delivery-summary` 是 store 内 artifact id，不应被理解为根目录 ignored 文件 `delivery-summary.md`；已补充说明。
- 后端热点仍集中在 `server/projects.js`、`server/workflows.js`、`server/index.js`、`server/routes/taskmaster.js`、`server/routes/git.js`。
- 前端热点仍集中在 chat session/composer/realtime hooks、`ChatInterface.tsx`、taskmaster/settings/sidebar 相关 controller。

## Exploration Map

```
┌────────────────────────┐
│ 21 已完成的第一轮整理  │
└───────────┬────────────┘
            │
            ▼
┌────────────────────────┐
│ 23 后续复核             │
├────────────────────────┤
│ 文档是否过期？          │
│ 生成物是否只是本地残留？│
│ 热点是否需要继续拆？    │
└──────┬─────────┬───────┘
       │         │
       ▼         ▼
   低风险清理   后续重构提案
```

## Approach

### 1. Baseline Audit

先记录当前仓库真实状态，而不是根据 `21-workflow-w1/tasks.md` 的勾选状态推断：

- 活跃 OpenSpec 变更。
- git 跟踪状态。
- ignored 生成物。
- package manager 状态。
- 主要文档和热点文件。

### 2. Documentation Cleanup

文档按用途分类：

- source documentation：应保留并更新。
- process artifact：若已被 ignored 或只服务单次交付，应删除或迁出。
- stale design note：若仍有架构价值，应更新状态；否则删除。

### 3. Refactor Candidate Triage

源码重构先只做候选排序，不直接修改：

- route 是否只做 request/response 适配。
- business logic 是否可以进入 `server/domains/<domain>`。
- 大组件是否可以抽出纯 transform、controller hook 或小 view。
- 是否已有测试能保护真实业务流。

### 4. Decision Gate

每个候选都必须进入以下三类之一：

| 类别 | 处理方式 |
|------|----------|
| 明确过期 | 删除或更新文档/生成物边界 |
| 有价值但不准 | 更新文档并标注当前状态 |
| 需要重构 | 新建更小的后续 OpenSpec 变更 |

## Documentation Classification

| 文件或位置 | 分类 | 处理 |
|-----------|------|------|
| `docs/workflow-state-design.md` | 保留更新 | 保留为 workflow 状态设计文档；澄清 `delivery-summary` 是 store artifact id，不是 ignored 根目录文件 |
| `public/convert-icons.md` | 保留更新 | 图标转换说明，未发现 generated workflow artifact 依赖 |
| `tests/spec/README.md` | 保留更新 | 规格测试说明，未发现 generated workflow artifact 依赖 |
| `MEMORY.md` | 后续确认 | 根目录长期记忆文件，当前复核不判断删除 |
| `openspec/changes/21-workflow-w1/*` | 保留更新 | 已完成变更的历史 artifact，作为 23 的基线证据保留 |
| 根目录 `delivery-summary.md` | 删除/不跟踪 | 本地 delivery 输出，已 ignored，不作为 source documentation |
| planner/execution/verification JSON | 删除/不跟踪 | 本地 workflow 输出，已 ignored，不作为 source documentation |

本次未发现需要迁出的 source 文档；迁出类为空。

## Generated Artifact Boundary

- `.gitignore` 覆盖 workflow 输出：`planner-output.json`、`execution-manifest.json`、`verification-evidence.json`、`delivery-summary.md`。
- `.gitignore` 覆盖运行输出：`.ccflow/`、`.playwright-cli`、`test-results`、`.openspec/cache/`、`.agents/cache/`、`.tmp/`、`dist/`、`.cache/`、本地 env。
- `git ls-files` 对这些路径无输出，说明它们不会进入 git 跟踪。
- 未发现未覆盖的新生成物，因此不需要补充 ignore 规则。

## Refactor Candidate Triage

| 候选 | 风险 | 现有测试保护 | 建议切片 | 独立 OpenSpec |
|------|------|--------------|----------|---------------|
| `server/projects.js` | 高：项目、会话、归档和路径逻辑混合 | `server/projects.*.test.js`、`tests/spec/project-*` | 先抽项目路径/会话读写纯 helper，再拆归档和 active session 操作 | 是 |
| `server/workflows.js` | 高：workflow 状态推进和持久化耦合 | `server/workflows.test.js`、`server/workflow-*.test.js`、workflow e2e/spec | 先抽 stage/status 计算与 artifact/session helper | 是 |
| `server/index.js` | 高：启动、路由装配和运行时配置集中 | 多数 server/spec 间接覆盖 | 先拆 server bootstrap、route registration、static/dev middleware | 是 |
| `server/routes/taskmaster.js` | 中高：外部命令和 HTTP 响应耦合 | 需要补业务级 taskmaster 路由测试后再拆 | 先封装命令参数构造和结果解析 | 是 |
| `server/routes/git.js` | 中：git 命令边界和 UI 状态耦合 | `tests/spec/git-panel-workflows.spec.js` | 先抽 git 命令 adapter 和 status parser | 是 |
| chat session/composer/realtime hooks | 高：真实会话流、重连和提交幂等 | chat server tests、chat e2e/spec | 先抽 message/session transform，再拆 realtime event reducer | 是 |
| `ChatInterface.tsx` | 中高：视图编排仍偏大 | chat e2e/spec | 只拆纯 view 子组件和 controller hook，不改消息协议 | 是 |
| taskmaster/settings/sidebar controller | 中：设置和导航状态影响面较广 | 需先补真实用户流程测试 | 先整理 controller 输入输出，再拆局部 state | 是 |

## Risks

- 误删过程文档中仍有价值的设计知识。缓解：先分类，再删除。
- 把本地 ignored 输出误判为仓库污染。缓解：同时检查文件存在、git 跟踪和 ignore 状态。
- 重构范围再次膨胀。缓解：23 只做复核和低风险清理；业务拆分另开变更。

## Verification Notes

- 已执行：`openspec list`。
- 已执行：`git status --short`。
- 已执行：`git status --short --ignored`。
- 已执行：`git ls-files` generated artifact 检查。
- 已执行：`pnpm run typecheck`，通过。
- 已尝试：`pnpm exec playwright test --config=playwright.spec.config.js tests/spec/chat-message-submission-idempotency.spec.js -g 'submitting an attachment message twice' --reporter=line`，30 秒内未完成；按本仓库等待约束停止，未观察到失败断言。
