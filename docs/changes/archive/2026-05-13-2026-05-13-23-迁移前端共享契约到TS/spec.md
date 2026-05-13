### 需求：共享消息契约必须由 TypeScript 描述

WebSocket 和项目 read model 的共享消息必须有 TypeScript 类型约束。

#### 场景：projects update reducer 使用类型化消息

- **当** 前端处理 `projects_updated` WebSocket 消息
- **则** reducer 输入必须使用 TypeScript 类型
- **且** `pnpm run typecheck` 必须覆盖该 reducer

#### 场景：Node 后端仍能启动

- **当** 共享消息工具迁移完成
- **则** `node server/index.js` 使用的生产 import 不得指向无法由 Node 直接执行的 `.ts` 文件
- **且** 不得新增 server TS 运行器

### 需求：API 客户端必须迁移到 TypeScript

前端 API 客户端必须提供基础类型，减少调用方猜测 response shape。

#### 场景：认证请求使用类型化 fetch helper

- **当** 前端调用认证 API 或普通 API
- **则** API helper 必须以 TypeScript 编写
- **且** 调用方仍能处理非 2xx、JSON 解析失败和网络异常

### 需求：聊天消息去重必须迁移到 TypeScript

聊天消息去重逻辑必须在 TS 下表达输入输出契约。

#### 场景：重复实时消息不会重复展示

- **当** co 或 Codex 事件重复到达
- **则** 前端必须按现有规则去重
- **且** 去重工具由 TypeScript 类型检查覆盖

### 需求：i18n 和会话活动工具必须迁移到 TypeScript

轻量工具应优先迁移，避免继续扩大 JS 面。

#### 场景：语言列表保持兼容

- **当** 设置页读取可选语言
- **则** `languages` 和 `isLanguageSupported` 行为保持不变
- **且** 文件迁移到 TypeScript 后相关测试仍通过

#### 场景：会话活动状态保持兼容

- **当** 项目主页计算会话活动状态
- **则** unread/running/idle 等展示逻辑保持不变
- **且** helper 迁移到 TypeScript 后静态测试引用新路径

### 需求：迁移不得改变服务端构建方式

本次迁移只改前端和共享契约，不引入服务端 TS 构建。

#### 场景：package scripts 保持 Node 服务端直接运行

- **当** 开发者检查 `package.json`
- **则** `server` 脚本仍可直接运行 Node 后端
- **且** 不得新增 `tsx server/*`、`ts-node` 或服务端编译步骤
