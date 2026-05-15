## 问题

`wo.yaml` 已经把执行、修复和归档阶段配置为 `pi`，工作流只读模型也能解析 `pi:*` 会话前缀。但 ccflow 的手动会话能力仍只把 `codex` 和 `opencode` 当作可用 provider。

这会造成两个实际问题：

- 用户不能像创建 Codex/OpenCode 会话一样从 Web UI 创建 Pi 会话。
- 工作流状态中出现 `pi:*` 会话时，ccflow 只能把它显示成不可跳转引用，无法和真实手动会话列表打通。

当前本机 `pi` CLI 可执行，但 `pi doctor --json` 不是稳定接口；因此本次变更不能假设 ccflow 可以直接读取 Pi 的完整账号或模型状态。Pi 聊天执行仍应由 `co` 文件协议承接。

## 目标

把 `pi` 引入为第三种手动会话 provider，与 `codex`、`opencode` 并列：

```text
ccflow UI
  |
  +-- Codex
  +-- OpenCode
  +-- Pi
        |
        v
      co-request-v1 provider="pi"
        |
        v
      co -> pi CLI
```

本次变更目标：

- 前后端共享 provider 类型支持 `codex | opencode | pi`。
- 手动会话创建、发送、续聊、终止和状态检查支持 Pi。
- co gate 支持 `providers.pi`，并在 Pi 不可用时明确失败。
- 前端新建会话入口、空会话 provider picker、侧边栏、项目概览和会话跳转都能识别 Pi。
- 工作流只读视图中 `pi:*` 会话在有匹配手动会话时可跳转，无匹配时仍不生成坏链接。
- 设置页和诊断页能展示 Pi CLI 的基础可用性，不误报完整账号认证能力。

## 范围

- 扩展手动 provider 契约和相关错误文案。
- 新增 `piSessions` read model，保持与 `codexSessions`、`opencodeSessions` 同级。
- 扩展 `co-client` provider 白名单、doctor provider normalization、request build 和事件类型。
- 扩展 WebSocket 消息发送、abort、status check 和 realtime 过滤逻辑。
- 扩展前端 provider 选择、provider logo、session provider inference、session list 合并和项目概览创建入口。
- 新增 Pi CLI 状态接口或诊断适配，只返回非敏感、可稳定判断的字段。
- 更新 `docs/specs/manual-provider-runner.md` 和 `docs/specs/workflow-wo-oz.md`。

## 非目标

- 不让 ccflow 直接 spawn 或管理 `pi` CLI 聊天进程。
- 不实现通用 provider 插件系统。
- 不实现 Pi 的完整模型目录、quota 或账号管理，除非 `pi` 或 `co` 提供稳定 JSON 契约。
- 不改变 `wo` 的阶段策略和提示词。
- 不重新引入已退休的 Claude provider。

## 测试意图

执行阶段需要在本提案 `tests/` 下先写真实测试，再同步到根测试套件：

- Server 单测覆盖 `co-client` 接受 `providers.pi`，构造 `provider="pi"` request，并继续拒绝未知 provider。
- Server/WebSocket 测试覆盖 Pi 手动会话发送只写 `co-request-v1`，不直接 spawn Pi。
- Server 测试覆盖 Pi provider unavailable 时不创建草稿、不写 pending request。
- 前端业务测试覆盖新建会话选择 Pi、Pi 会话进入 `piSessions`、项目概览和侧边栏能打开 Pi 会话。
- 工作流 read model 测试覆盖 `pi:*` 有匹配会话时可跳转，无匹配时保持 unlinked。
- 设置页或诊断测试覆盖 fake `pi` 在服务进程 `PATH` 中时显示可用，缺失时显示明确错误。
