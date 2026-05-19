# 设计：彻底移除OpenCode支持

## 现状判断

OpenCode 目前不是一个孤立入口，而是贯穿 Provider 类型、项目 read model、设置页、聊天发送、co 文件协议、REST 路由和测试契约：

```text
OpenCode dependency graph
├── src/types/app.ts                         SessionProvider
├── src/components/settings                  AgentProvider / 状态检查 / 账号面板
├── src/components/chat                      provider picker / composer / realtime handlers
├── src/hooks/useProjectsState.ts            opencodeSessions 路由推断
├── src/components/sidebar + main-content    会话聚合和展示
├── server/projects.ts                       OpenCode SQLite/CLI session index
├── server/index.ts                          REST route + WebSocket opencode-command
├── server/co-client.ts                      provider 白名单和事件类型
├── server/routes/opencode.ts                OpenCode CLI status route
└── server/opencode-sdk.ts                   OpenCode SDK/CLI adapter
```

因此执行阶段不能只删 UI 文案；必须从类型源头和后端入口一起收敛，否则会出现编译通过但运行时仍可调用 OpenCode 的半删除状态。

## 决策 1：Provider 类型先收窄

先把公共 Provider 类型收敛到 Codex/Pi：

```text
SessionProvider = 'codex' | 'pi'
AgentProvider   = 'codex' | 'pi'
```

这样 TypeScript 会自然暴露所有仍依赖 `opencode` 的前端分支。执行阶段应以类型错误作为清理清单，而不是靠全仓库字符串替换。

## 决策 2：后端入口直接删除 OpenCode

后端应删除 OpenCode 的可调用入口和适配文件，而不是保留拒绝分支：

- 不注册 `/api/cli/opencode`。
- WebSocket 不处理 `opencode-command`。
- shell provider 不再把 `provider=opencode` 映射为 OpenCode CLI。
- `buildCoRequest()` 不接受 `provider: "opencode"`。
- `active-sessions` 不再返回 `opencode` bucket。
- 删除 `server/routes/opencode.ts` 和 `server/opencode-sdk.ts`。

如果旧客户端仍发送 OpenCode 消息，不新增专门兼容处理；它应自然落入不存在命令的通用错误路径或被当前协议校验拒绝。

## 决策 3：项目 read model 不再返回 opencodeSessions

`/api/projects` payload 应移除 `opencodeSessions`，项目发现也不再读取：

- `OPENCODE_DB_PATH`
- `~/.local/share/opencode/opencode.db`
- `opencode session list`

项目 payload、配置读写和前端状态都不再保留 `opencodeSessions` 字段。执行阶段可以删除 cbw 项目配置里由 OpenCode 支持产生的字段读写逻辑；不为旧字段保留迁移、隐藏或只读展示路径。

## 决策 4：历史 OpenCode 分支一并删除

执行阶段不为历史 `opencode:executor`、`opencode:planner`、`provider: "opencode"` 保留只读 UI 或 fallback。相关读取、展示、跳转和续聊逻辑直接删除：

```text
旧 OpenCode 数据
├── 不参与项目发现
├── 不进入侧边栏或主页会话列表
├── 不进入工作流可点击子会话列表
└── 不产生任何续聊、跳转或只读兼容分支
```

不把旧 OpenCode 数据强制改写为 Codex/Pi，也不显示“unsupported OpenCode”。彻底移除意味着当前产品界面和运行时代码不再认识这个 Provider。

## 决策 5：测试从“支持 OpenCode”改为“OpenCode 不存在”

当前大量测试是为了证明 OpenCode 支持存在。执行阶段需要删除这些正向测试，补充少量反向契约：

```text
反向契约
├── UI 不显示 OpenCode provider
├── server 不注册 OpenCode route
├── co request 不接受 OpenCode
├── projects payload 不返回 opencodeSessions
├── runtime source 不引用 OpenCode SDK/DB/CLI
├── runtime docs 不声明 OpenCode 支持
└── settings 不请求 OpenCode status
```

测试重点是用户可见入口、真实服务接口、源码静态契约和运行时文档。不要再构造“旧 OpenCode 历史项目”“旧 OpenCode 工作流”等伪造 fixture；这些会把兼容性重新带回测试目标。

## 风险

- 风险：删除 `opencodeSessions` 后旧项目中的历史 OpenCode 会话不再出现在首页。
  - 处理：这是本变更的预期效果，不补兼容入口。

- 风险：工作流历史引用旧 OpenCode provider 导致 UI 类型收窄后编译错误。
  - 处理：删除对应 OpenCode 分支；必要时让泛型历史字段保持 string，但不在 UI 或发送路径识别 OpenCode。

- 风险：直接删除测试文件可能掩盖 Codex/Pi 回归。
  - 处理：只删除 OpenCode 专属正向测试；混合 Provider 测试要改成 Codex/Pi 业务场景。

- 风险：全仓库 `opencode` 字符串仍存在于归档文档。
  - 处理：归档文档不属于运行时支持面，不作为执行阶段清理目标。

## 测试设计

- `tests/server/...remove-opencode-runtime.test.ts`：静态/运行时断言 OpenCode route、SDK、WebSocket command 和 co provider 白名单已移除。
- `tests/server/...projects-no-opencode-provider.test.ts`：通过真实项目发现入口断言返回项目不包含 `opencodeSessions`，并静态断言源码不再引用 OpenCode DB/CLI。
- `tests/spec/...provider-picker-no-opencode.spec.ts`：打开项目新会话入口，断言只有 Codex/Pi 可选。
- `tests/spec/...settings-no-opencode.spec.ts`：打开设置页，断言 Agent 列表不显示 OpenCode，网络层不请求 `/api/cli/opencode/status`。
- `tests/spec/...runtime-docs-no-opencode.spec.ts`：静态断言 README、测试说明和当前活动文档不再声明 OpenCode 是支持 Provider。
