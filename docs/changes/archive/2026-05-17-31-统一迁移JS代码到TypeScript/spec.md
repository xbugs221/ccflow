### 需求：tracked JS 源码必须迁移到 TypeScript

仓库中被 git 跟踪的源码、脚本、配置和测试应统一使用 TypeScript。

#### 场景：前端入口和组件不再使用 JSX 文件

- **当** 开发者扫描 `src/`
- **则** 不得存在 `.jsx` 文件
- **且** `src/main.jsx` 必须迁移为 `src/main.tsx`
- **且** React 组件必须用 `.tsx` 表达 props、context 和事件类型

#### 场景：后端和 shared 不再使用 JS 源码

- **当** 开发者扫描 `server/` 和 `shared/`
- **则** 不得存在 `.js`、`.mjs` 或 `.cjs` 源码文件
- **且** 共享工具必须从 `.ts` 源码直接导出运行函数和类型

#### 场景：脚本和配置纳入迁移范围

- **当** 开发者扫描 `scripts/` 和根目录配置文件
- **则** 保留的脚本和配置必须迁移为 `.ts`
- **且** 如果外部工具短期只能加载 JS shim，该 shim 必须列入例外清单并说明退出条件

#### 场景：测试文件迁移为 TypeScript

- **当** 开发者扫描 `tests/`
- **则** server、spec、e2e、manual 测试文件和 helper 应迁移为 `.ts`
- **且** 测试仍然验证真实业务行为，而不是只验证文件扩展名

### 需求：TypeScript 配置必须覆盖全仓核心代码

迁移完成后 typecheck 应覆盖前端、后端、共享工具、脚本和测试关键路径，不能继续依赖 `allowJs`。

#### 场景：tsconfig 不再允许 JS 兜底

- **当** 开发者运行 TypeScript 配置契约测试
- **则** 所有主 tsconfig 都不得设置 `allowJs: true`
- **且** 不得通过排除 JS 文件来掩盖未迁移代码

#### 场景：前后端配置分离

- **当** 开发者查看 tsconfig
- **则** 前端、Node 服务端和测试应有清晰的配置边界
- **且** `pnpm run typecheck` 必须覆盖这些边界

#### 场景：编译输出不进入仓库

- **当** 服务端 TypeScript 需要编译为 Node 可执行 JS
- **则** 输出目录必须位于 `.gitignore` 已忽略路径
- **且** 不得提交编译产物

### 需求：Node 运行入口必须在迁移后可执行

把 server 和 scripts 改成 TS 后，所有命令入口必须仍可运行。

#### 场景：开发服务可启动

- **当** 开发者运行 `pnpm run server`
- **则** 后端应通过明确的 TS runner 或编译产物启动
- **且** 不得指向 Node 无法直接执行的 `.ts` 文件

#### 场景：CLI bin 可执行

- **当** 用户执行 `cbw`
- **则** bin 入口必须指向可被 Node 执行的文件
- **且** 行为保持与迁移前的 `server/cli.js` 一致

#### 场景：postinstall 脚本可执行

- **当** 用户运行 `pnpm install`
- **则** postinstall 不得因为脚本迁移为 TS 而失败
- **且** 不得依赖未声明的传递依赖执行 TS

#### 场景：测试 runner 可执行 TS 测试

- **当** 开发者运行 `pnpm run test:server` 和 `pnpm run test:spec`
- **则** Node test 与 Playwright 都必须能加载 TS 测试和 TS helper
- **且** 测试命令不应继续扫描旧 `.js` 测试模式

### 需求：JS 声明配对必须消失

迁移后不得继续维护 `.js` 实现和 `.d.ts` 声明的重复源。

#### 场景：shared 声明由 TS 源码生成或导出

- **当** 开发者扫描 `shared/`
- **则** 不得存在与同名 `.js` 文件配对的 `.d.ts`
- **且** 类型必须从 `.ts` 源码中维护

#### 场景：前端工具声明不再手写配对

- **当** 开发者扫描 `src/components` 和 `src/hooks`
- **则** 不得存在 `messageDedup.js`、`sessionMessageDedup.js`、`sessionActivityState.js` 这类 JS 实现配对声明
- **且** 调用方导入路径必须指向 TS 模块

### 需求：业务行为必须保持不变

TypeScript 迁移不得改变用户可见行为或 API 契约。

#### 场景：项目和会话行为保持稳定

- **当** 用户打开项目、查看会话、创建手动会话或续聊
- **则** 项目列表、会话路由、provider 状态和消息渲染保持迁移前行为
- **且** 后端响应字段不因类型迁移被重命名或删除

#### 场景：工作区工具保持可用

- **当** 用户使用聊天、文件树、编辑器、Git 面板、Shell 面板、设置页和 workflow 详情
- **则** 这些路径仍按真实业务测试通过
- **且** 页面不得因为导入扩展名或类型转换错误空白

#### 场景：运行依赖诊断保持可读

- **当** oz、wo、co、Codex、OpenCode 或 Pi 缺失
- **则** diagnostics 返回的缺失命令、检查动作和 PATH 信息保持清晰
- **且** 类型迁移不得吞掉原有错误原因

### 需求：迁移质量必须可审查

迁移不是无类型重命名，必须让审阅者能看到业务类型边界。

#### 场景：新增类型表达真实业务结构

- **当** 迁移 API response、WebSocket message、workflow run、provider session、project config 等对象
- **则** 类型命名必须表达业务含义
- **且** 不得用宽泛 `Record<string, unknown>` 替代已知稳定字段

#### 场景：`any` 只能用于外部输入边界

- **当** 代码需要处理未知 JSON、CLI 输出或第三方库事件
- **则** 可以在解析边界短暂使用 `unknown` 或受控 `any`
- **但** 进入业务函数前必须归一化为明确类型
