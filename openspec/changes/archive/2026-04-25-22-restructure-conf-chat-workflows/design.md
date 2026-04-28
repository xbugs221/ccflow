## Context

项目本地配置文件 `.ccflow/conf.json` 目前用多个互相引用的平铺字段描述同一批会话：`sessionRouteIndex` 管编号，`sessionSummaryById` 管标题，`manualSessionDrafts` 管草稿，`sessionWorkflowMetadataById` 管工作流归属，`sessionModelStateById` 管 Codex 模型，`sessionUiStateByPath` 管 UI 状态。这些字段对机器可用，但对人类不直观，也让 WebUI 会话、终端 Codex 会话和工作流内部会话之间的编号同步变复杂。

目标结构改为两个顶层分组：

```json
{
  "schemaVersion": 2,
  "chat": {
    "1": {
      "sessionId": "c1",
      "title": "会话1",
      "model": "gpt-5.5",
      "reasoningEffort": "medium",
      "ui": {}
    }
  },
  "workflows": {
    "1": {
      "title": "重构配置",
      "chat": {
        "1": {
          "sessionId": "real-child-session-id",
          "title": "执行会话",
          "model": "gpt-5.5",
          "reasoningEffort": "medium",
          "ui": {}
        }
      }
    }
  }
}
```

`workflows["1"]` 的运行时工作流 id 由代码推导为 `w1`，不写入配置。工作流内部 `chat` 编号只在该 workflow 内部有意义，不占用顶层 `chat` 编号。

## Goals / Non-Goals

**Goals:**

- 让 `.ccflow/conf.json` 中的会话配置按人类可读的 `chat` / `workflows` 分组存储。
- 顶层 `chat` 统一管理 WebUI 手动会话和终端 Codex 会话的编号、标题、模型、思考深度和 UI 状态。
- 工作流内部会话只存储在对应 `workflows[n].chat` 中，按流程顺序编号。
- 草稿创建时先占用稳定编号和草稿 `sessionId`，真实请求完成后只替换同一条记录的 `sessionId`。
- 从旧字段迁移到 v2；新写入不再产生旧会话字段。

**Non-Goals:**

- 不改变前端路由格式，仍保留项目内 `cN` 和 `wN/cN` 语义。
- 不改变 provider transcript 文件格式。
- 不把 workflow 的完整运行状态塞进 `conf.json`；工作流控制面仍可继续使用现有 workflow 存储，`conf.json` 只保存导航和会话映射所需的精简状态。
- 不回收已删除的顶层 chat 编号或 workflow 编号。

## Decisions

### 1. `sessionId` 作为 value，不作为 key

配置对象的 key 只表达项目内展示编号，真实 provider session id 存在 `sessionId` 字段。这样人读配置时能直接看出编号顺序，也避免旧结构里数字 key、`cN` key 和真实 session id 混用。

备选方案是继续使用真实 session id 做 key，但会导致人工排查时必须跨字段查编号和标题，不符合本次重构目标。

### 2. workflow id 由数字组名推导

`workflows["1"]` 在运行时推导为 `w1`，配置中不写 `workflowId`。这保持配置简洁，满足项目内 workflow 编号不重复的需求。

备选方案是在 workflow value 中写 `workflowId`，但它与 key 完全重复，且容易再次形成双数据源。

### 3. 草稿与真实会话共用同一条记录

WebUI 新建会话时立即写入 `chat[n]`，`sessionId` 先为草稿 id，例如 `c20`。provider 返回真实 session id 后，将 `chat[n].sessionId` 替换为真实 id。标题、编号、模型和 UI 状态留在原记录中。

工作流内部草稿同理：先写 `workflows[w].chat[n].sessionId = cN`，finalize 时只替换该字段。草稿失败或未发送时保留草稿记录，用户删除草稿时删除对应记录，但编号不回收。

备选方案是继续用 `manualSessionDrafts` 暂存草稿，再 finalize 时迁移到正式映射；这正是当前容易产生同步 BUG 的来源。

### 4. 旧字段只作为 migration 输入

读取配置时需要接受旧字段，组装成 v2 runtime config；保存时只写 `schemaVersion`、`chat`、`workflows` 和必要的非会话项目配置字段。旧字段不再写回。

备选方案是长期双写 v1/v2，但双写会继续制造状态不一致。

### 5. 终端 Codex 会话并入顶层 `chat`

扫描到同项目路径下的新 Codex transcript 后，如果它不是工作流内部会话，系统在顶层 `chat` 中分配下一个未回收编号，并将标题设为第一条真实用户指令。没有用户指令时可以保留已有 fallback 标题。

## Risks / Trade-offs

- [Risk] 旧配置迁移遗漏某个字段会导致标题、模型或 UI 状态丢失。→ Mitigation：migration 测试覆盖标题、模型、思考深度、UI 和 workflow 归属。
- [Risk] 草稿 finalize 与后台会话扫描同时发生，可能产生重复记录。→ Mitigation：finalize 必须按草稿 `sessionId` 定位已有编号并原地替换，扫描逻辑在分配新编号前必须先查找该真实 session id 是否已存在。
- [Risk] `wN` 由 key 推导后，删除 workflow 再新建 workflow 时不能复用编号。→ Mitigation：保存 workflow high-water counter 或从现有 `workflows` 最大 key 推导下一编号，并明确不回收。
- [Risk] 工作流控制面仍有独立 workflow 存储。→ Mitigation：`conf.json` 只作为导航会话索引，workflow 执行状态继续以现有 workflow 存储为准。

## Migration Plan

1. 增加 v2 config adapter：读取时如果存在 `schemaVersion: 2` 则直接解析 `chat` / `workflows`；否则从旧字段合成 v2。
2. 将标题、UI、模型和 route-index helper 改为读写 v2 adapter。
3. 改造草稿创建和 finalize：创建时写目标 `chat` 记录，finalize 原地替换 `sessionId`。
4. 改造 Codex 扫描导入：standalone 会话写顶层 `chat`，工作流内部会话写 `workflows[n].chat`。
5. 改造 workflow 注册：使用 workflow 数字 key 推导 `wN`，内部会话不占用顶层编号。
6. 保存时输出 v2，并删除旧会话字段。
7. 回滚策略：保留 migration 入口；如果需要回滚代码，先备份 `.ccflow/conf.json`。v2 不再写旧字段，因此旧版本代码不能完整理解新配置。

## Open Questions

- workflow 自身除标题外是否还需要在 `conf.json` 中保存 UI 状态，例如折叠、收藏或隐藏。本次不做，后续有明确 UI 需求再添加。
- 终端 Codex 会话没有可解析第一条用户指令时，标题 fallback 是继续沿用现有 summary 逻辑，还是固定为 `会话n`。本次设计允许保留现有 fallback。
