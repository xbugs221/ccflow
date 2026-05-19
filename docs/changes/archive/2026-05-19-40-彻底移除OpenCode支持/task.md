# 任务：彻底移除OpenCode支持

## 1. 建立删除边界和反向契约

- [x] 1.1 梳理运行时代码中的 OpenCode 引用，区分源码、测试、文档归档。
- [x] 1.2 新增或改写 server 反向契约，覆盖 OpenCode 路由、co provider 和项目 payload 不存在。
- [x] 1.3 新增或改写 browser/spec 反向契约，覆盖 Provider picker 和设置页不显示 OpenCode。
- [x] 1.4 新增文档反向契约，覆盖 README 和测试说明不再声明 OpenCode 支持。
- [x] 1.5 测试不得伪造旧 OpenCode 项目、会话或工作流 fixture，只基于真实源码、真实接口、真实页面和真实文档断言。

## 2. 收窄 Provider 类型和前端入口

- [x] 2.1 将 `SessionProvider` 收窄为 Codex/Pi。
- [x] 2.2 将 `AgentProvider` 和 `AGENT_PROVIDERS` 收窄为 Codex/Pi。
- [x] 2.3 移除 Provider 选择空状态和项目主页的新建 OpenCode 会话按钮。
- [x] 2.4 移除设置页 OpenCode 状态、登录回调、账号面板和文案。
- [x] 2.5 移除 OpenCode Logo 组件引用和消息标签分支。
- [x] 2.6 删除侧边栏、项目主页、聊天、工作流详情中的 `opencodeSessions` 路由推断和 OpenCode 历史兼容分支。

## 3. 移除后端 OpenCode 支持面

- [x] 3.1 删除 OpenCode REST 路由注册和相关 route 模块。
- [x] 3.2 删除 OpenCode SDK/CLI adapter 模块及其导入。
- [x] 3.3 移除 `opencode-command` WebSocket 分支、OpenCode abort/error/complete 分支和 active session bucket。
- [x] 3.4 移除 shell WebSocket 中 `provider=opencode` 启动 OpenCode CLI 的逻辑。
- [x] 3.5 将 co provider 白名单、事件类型和 doctor provider 归一化收窄到 Codex/Pi。
- [x] 3.6 移除项目发现中的 OpenCode SQLite/CLI 索引、`opencodeSessions` payload 和相关缓存。
- [x] 3.7 删除旧 OpenCode 配置、工作流角色和历史会话的兼容读取或只读展示逻辑。

## 4. 清理测试和文案

- [x] 4.1 删除 OpenCode 正向集成测试文件或改写为反向契约。
- [x] 4.2 删除混合 Provider 测试中的 OpenCode 样例；需要覆盖 Codex/Pi 时使用真实 Codex/Pi 业务场景。
- [x] 4.3 更新中英文运行时文案，移除 Codex/OpenCode 并改为 Codex/Pi 或通用 Agent 表述。
- [x] 4.4 更新 README、测试说明、活动 docs/specs 中关于 Provider 支持面的文档。
- [x] 4.5 保留 `docs/changes/archive/**` 历史文档中的 OpenCode 文字，不做归档改写。
- [x] 4.6 运行全仓库搜索，确认 `src/`、`server/`、`shared/`、活动测试和运行时文档中没有 OpenCode 支持引用。

## 5. 验证

- [x] 5.1 运行 `pnpm run typecheck`。
- [x] 5.2 运行相关 server 测试，确认 OpenCode 后端入口不存在且 Codex/Pi 正常。
- [x] 5.3 运行相关 spec/browser 测试，确认 UI 不显示 OpenCode。
- [x] 5.4 运行 `pnpm run test` 或记录无法完整运行的原因和替代验证。
- [x] 5.5 运行 `oz validate 40-彻底移除OpenCode支持 --json`。

## 验证记录

- `pnpm run typecheck` 通过。
- `pnpm run test:server` 通过。
- `pnpm run test:spec:node` 通过。
- `pnpm exec tsx --test docs/changes/40-彻底移除OpenCode支持/tests/*.test.ts` 通过。
- `pnpm run test:spec:browser` 已尝试，Vite 启动阶段因 `EMFILE: too many open files, watch 'vite.config.ts'` 退出，未进入浏览器断言。
- `oz validate 40-彻底移除OpenCode支持 --json` 通过。
