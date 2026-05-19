# 40-彻底移除OpenCode支持

## 问题

仓库当前仍把 OpenCode 作为一等 Provider 支持，覆盖范围包括前端 Provider 选择、设置页状态、项目会话发现、WebSocket 聊天发送、co request provider 白名单、OpenCode REST 路由、SDK、历史读取和大量契约测试。

这带来三个维护成本：

```text
OpenCode 支持面
├── 前端 UI 和类型系统需要继续维护 opencode 分支
├── 后端项目发现需要读取 OpenCode SQLite/CLI 索引
├── 聊天发送和 co 协议需要保留 opencode 命令路径
└── 测试会持续要求 OpenCode 行为存在
```

如果产品方向已经不再支持 OpenCode，保留这些分支会让后续 Codex/Pi 逻辑改动变慢，也会让用户在 UI 中看到不可用入口。

## 目标

- 从运行时代码中彻底移除 OpenCode Provider 支持。
- 前端只展示 Codex 和 Pi 相关入口，不再出现 OpenCode 选项、文案、Logo 或设置面板。
- 后端不再注册 `/api/cli/opencode` 路由，不再读取 OpenCode SQLite/CLI，不再接受 `opencode-command` WebSocket 消息。
- `SessionProvider`、`AgentProvider`、co provider 白名单和项目 read model 只保留 Codex/Pi。
- 不为旧 OpenCode 项目配置、历史会话或工作流子会话保留兼容读取、只读展示或 fallback。
- 移除或改写要求 OpenCode 存在的测试，新增反向契约防止 OpenCode 支持回流。
- 同步更新运行时文档、README 和测试说明，避免文档继续声称支持 OpenCode。

## 范围

```text
cbw
├── server
│   ├── 移除 OpenCode SDK 和 REST 路由
│   ├── 移除项目发现中的 opencodeSessions 和 OpenCode 索引
│   ├── 移除 WebSocket opencode-command / opencode abort / active sessions 分支
│   ├── 收窄 co provider schema 和事件类型
│   └── 保留 Codex/Pi 聊天和历史读取行为
├── src
│   ├── 收窄 AgentProvider / SessionProvider 类型
│   ├── 移除 Provider picker 中 OpenCode 入口
│   ├── 移除设置页 OpenCode 状态和账号面板
│   ├── 移除 OpenCode logo 和消息标签分支
│   └── 清理侧边栏、主页、工作流详情中的 opencodeSessions 判断
├── shared
│   └── 清理 OpenCode 相关共享常量或 provider 判定
└── tests
    ├── 删除 OpenCode 正向集成测试
    ├── 删除或改写混有 OpenCode 的旧测试
    └── 新增 OpenCode 不再暴露的反向契约测试
├── docs
│   ├── 更新 README 和测试说明中的 Provider 表述
│   └── 保留归档提案原文，仅在当前运行时文档中移除 OpenCode 支持声明
```

## 非目标

- 不修改已归档 `docs/changes/archive/**` 中的历史描述。
- 不负责删除用户主目录中的外部 OpenCode 数据文件；cbw 只保证不再读取、写入、展示或启动这些数据。
- 不重做 Codex 或 Pi 的交互设计。
- 不引入新的 Provider 抽象层。
- 不改变 OpenSpec/oz/wo 工作流本身的业务语义，除非它们显式依赖 OpenCode provider 枚举。

## 测试策略

执行阶段应在本提案 `tests/` 目录写真实测试代码，再在归档时迁移到根 `tests/`：

- Server 契约测试断言 `server/index.ts` 不注册 `/api/cli/opencode`，且 `server/routes/opencode.ts`、`server/opencode-sdk.ts` 不再作为运行时模块存在。
- Server 测试断言 co provider normalizer、request builder 和 doctor gate 不接受 `opencode`。
- Server 测试使用真实项目发现路径，断言 `/api/projects` payload 不包含 `opencodeSessions`，且项目发现源码不再引用 `OPENCODE_DB_PATH` 或 OpenCode CLI。
- Browser/spec 测试断言新建会话入口只显示 Codex/Pi，不存在 OpenCode 按钮和 `project-new-session-provider-opencode`。
- Browser/spec 测试断言设置页 Agent 列表只显示 Codex/Pi，不请求 `/api/cli/opencode/status`。
- 文档测试断言 README、测试说明和当前活动文档不再宣称 Codex/OpenCode 支持。
- 不再伪造旧 OpenCode 数据 fixture；测试只检查真实源码、真实构建产物、真实 API 和真实 UI 表面。
