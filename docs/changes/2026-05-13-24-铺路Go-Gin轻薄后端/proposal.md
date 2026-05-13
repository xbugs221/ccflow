## 问题

ccflow 的目标形态是轻薄 Web 外壳：

- 工作流执行由 `wo` 管理。
- 聊天和会话执行由 `co` 管理。
- 前端保留 shell/file/git/workspace UI。
- 后端只负责 auth、静态资源、文件操作、shell WebSocket、Git helper、co/wo read model 和事件转发。

当前 Express 后端仍承担很多历史职责。直接全量重写到 Go/Gin 风险过高，因为文件、shell、WebSocket、项目 read model 和 co/wo tail 行为都需要严格兼容。

## 目标

本次变更不替换 Node 后端，而是为 Go/Gin 影子后端铺路：

- 固化 thin backend 的 REST/WS 合约。
- 定义 Go/Gin 影子服务的目录、启动方式和兼容性测试策略。
- 选择一小组低风险只读 API 作为第一批 shadow implementation。
- 保持现有前端、Node 后端和发布流程不变。

## 范围

- 新增后端边界文档，定义 ccflow thin backend 职责。
- 新增 Go/Gin 影子服务骨架规划，不接管生产端口。
- 定义 contract tests，可同时验证 Node 和 Go 实现。
- 第一阶段候选 API：
  - health/status
  - runtime diagnostics read-only
  - wo/co state read-only adapters 的只读端点
  - 静态 dist 服务的本地验证

## 非目标

- 不在本提案中删除 Express 后端。
- 不迁移 shell PTY WebSocket 到 Go。
- 不迁移文件写入、上传、下载和 Git mutation。
- 不改变 co/wo 协议。
- 不改变前端构建、路由和部署入口。

## 测试意图

执行阶段需要新增真实测试：

- contract tests：同一请求集可跑 Node backend 和 Go shadow backend。
- Go shadow smoke test：启动非生产端口，验证 health 和只读端点。
- 静态资源测试：Go shadow 能服务 Vite build 产物但不影响 Node `pnpm run server`。
- 边界守卫测试：Go shadow 不实现 mutation、shell、file write 时必须明确返回未实现或不注册路由。
