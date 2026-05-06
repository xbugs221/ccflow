## Context

当前项目改名链路只把 `displayName` 按 `projectName` 写入 `~/.claude/project-config.json`，但项目列表聚合时对 Codex-only 项目不会读取该配置，且其 `projectName` 可能由路径推导并不稳定，导致改名刷新后丢失。

聊天输入区 mode 按钮旁当前使用 `TokenUsagePie` 展示上下文 token 百分比，这与用户真正关心的配额窗口（5 小时 / 7 天）不一致。现有本机配置中两条 provider 链路已经有 statusline 语义：
- Claude：`~/.claude/settings.json` 的 `statusLine.command`（脚本可产出 5h/7d 使用率）。
- Codex：`~/.codex/config.toml` 的 `tui.status_line = ["five-hour-limit", "weekly-limit", ...]`。

本次变更是跨后端聚合、接口与前端组件的联动改造。

## Goals / Non-Goals

**Goals:**
- 改名后的项目展示名在刷新后稳定生效，覆盖 Claude、手工项目、Codex-only 项目。
- 输入区展示 `5hours/7days remaining`，并按 provider 分别取数与计算。
- 额度数据不可用时保持可降级，不影响消息发送和会话切换。

**Non-Goals:**
- 不改动 CLI 本身的 statusline 功能实现。
- 不在本次变更中重构会话存储格式。
- 不做跨设备/跨账号的配额同步。

## Decisions

### 1) 项目展示名改为“路径优先”的持久化键
- **Decision**: 在现有 `project-config.json` 中新增路径索引（如 `displayNameByPath`），键为规范化绝对路径；保留旧的 `config[projectName]` 读取兼容。
- **Rationale**: 项目路径对 Claude/manual/Codex-only 都稳定，避免 Codex-only 项目名推导导致的丢失。
- **Alternatives considered**:
  - 仅继续使用 `projectName`：无法解决 Codex-only 刷新丢失。
  - 新建独立配置文件：可行，但引入额外迁移与读写分散成本。

### 2) 改名接口补充项目路径入参
- **Decision**: `/api/projects/:projectName/rename` 接口新增可选 `projectPath`，前端在改名时一并提交 `selectedProject.fullPath`。
- **Rationale**: 后端在写入路径索引时需要稳定主键；保留 `projectName` 兼容老请求。
- **Alternatives considered**:
  - 后端自行二次推导路径：对 Codex-only 项目不稳定且多一次查找链路。

### 3) 统一项目列表中的展示名解析逻辑
- **Decision**: 抽出 `resolveDisplayName(projectName, fullPath, config)`，在 Claude 目录项目、手工项目、Codex-only 项目三条聚合路径统一调用。
- **Rationale**: 避免不同分支重复逻辑和后续行为漂移。
- **Alternatives considered**:
  - 各分支分别补丁：短期快但长期易回归。

### 4) 新增 provider-usage-remaining 统一读取层
- **Decision**: 新增后端“额度剩余”读取接口（例如 `GET /api/usage/remaining?provider=...`），返回统一字段：`fiveHourRemaining`、`sevenDayRemaining`、`updatedAt`、`source`；前端只关心统一模型。
- **Rationale**: Claude/Codex 来源不同，但 UI 需要统一渲染与降级策略。
- **Alternatives considered**:
  - 前端直接分别读本地文件：不安全、不可复用、与现有 API 架构不一致。

### 5) 额度取数按 provider 独立适配
- **Decision**:
  - Claude 适配器优先读取现有 statusline 相关缓存数据（与 `statusLine.command` 产物一致），必要时再触发轻量刷新。
  - Codex 适配器按 `~/.codex/config.toml` 中 status line 语义映射 5h/7d 指标并独立解析。
- **Rationale**: 满足“按 provider 分别设置”的需求，避免把 Claude 的计算方式硬套到 Codex。
- **Alternatives considered**:
  - 继续显示 token 百分比：信息价值低，不满足需求。

## Risks / Trade-offs

- [Risk] 旧配置与新路径索引并存可能出现冲突  
  → Mitigation: 明确优先级（路径键 > 项目名键 > 自动名），并在写入时同步更新。

- [Risk] provider 额度来源格式变化导致解析失败  
  → Mitigation: 解析层做健壮兜底，返回 `unavailable` 状态并在 UI 显示占位文本。

- [Risk] 高频读取配置/缓存带来 I/O 开销  
  → Mitigation: 后端增加短 TTL 内存缓存（例如 30-60 秒）。

- [Risk] Codex 的 5h/7d 数据源细节与当前假设不一致  
  → Mitigation: 在实现首步增加源验证任务，并保留 feature fallback。

## Migration Plan

1. 在后端加入路径索引读写与兼容逻辑，保证不改前端也不破坏现有改名。
2. 前端改名请求补充 `projectPath`，并验证刷新后名称稳定。
3. 增加 provider-usage-remaining 接口及 Claude/Codex 适配器。
4. 前端替换 `TokenUsagePie` 为 `5hours/7days remaining` 展示组件，并接入 provider 数据。
5. 灰度验证后移除旧百分比组件引用。

**Rollback**: 前端可快速切回 `TokenUsagePie`；后端保留新增字段但不被消费即可，不影响旧会话与项目数据。

## Open Questions

- Codex 的 5h/7d 原始数值在当前 CLI 版本中的最稳定来源是什么（直接状态源、缓存文件或可调用命令输出）？
- 当 provider 返回“未知/不可用”时，UI 文案是否固定为 `-- / -- remaining`，还是显示 `N/A` 并附带 tooltip？
