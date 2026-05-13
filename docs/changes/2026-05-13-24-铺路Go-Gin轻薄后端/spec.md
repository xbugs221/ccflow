### 需求：必须定义 thin backend 职责边界

系统必须明确 ccflow 后端只是 Web 外壳，不承担 co/wo 的执行职责。

#### 场景：后端边界文档列出保留职责

- **当** 开发者阅读后端边界文档
- **则** 文档必须列出 auth、static、file、shell、git、co/wo read model 和事件转发职责
- **且** 明确工作流执行属于 wo，聊天执行属于 co

#### 场景：后端边界文档列出非职责

- **当** 开发者阅读后端边界文档
- **则** 文档必须说明 ccflow 后端不得直接执行 provider CLI
- **且** 不得重新实现 wo/co 状态机

### 需求：Go/Gin 影子后端不得接管生产入口

Go/Gin 影子服务必须可独立启动，但不能影响现有 Node 服务。

#### 场景：启动 Go shadow backend

- **当** 开发者运行 Go shadow 命令
- **则** 服务必须监听显式指定的非生产地址
- **且** 不得修改 `pnpm run server`、`pnpm run dev` 或 `pnpm run start` 的现有行为

#### 场景：Go shadow backend 只实现只读端点

- **当** 客户端请求尚未迁移的 mutation、shell 或 file write 路由
- **则** Go shadow backend 必须明确返回未实现或不注册该路由
- **且** 不得静默执行不完整操作

### 需求：只读端点必须通过 contract tests 固化

Node 后端和 Go shadow 后端的只读响应必须由同一批测试验证。

#### 场景：health/status 合约一致

- **当** contract tests 分别请求 Node 和 Go 的 health/status 端点
- **则** 两者必须返回稳定的 ok/status 字段
- **且** 测试不得依赖实现私有字段

#### 场景：co/wo 只读状态合约一致

- **当** fixture 写入 co/wo 状态文件
- **则** Node 和 Go 只读端点必须返回相同的稳定 read model 字段
- **且** 不得修改 fixture 状态文件

### 需求：静态资源服务必须可验证

Go shadow backend 必须能验证未来服务前端 dist 的能力。

#### 场景：服务 Vite build 产物

- **当** 存在 `dist/index.html`
- **则** Go shadow backend 的静态资源 smoke test 必须能读取首页
- **且** SPA fallback 对未知前端路由返回 index
