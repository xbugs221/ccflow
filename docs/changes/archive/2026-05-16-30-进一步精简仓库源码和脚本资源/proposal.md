## 问题

上一份提案已经计划移除 TaskMaster 和 lucide 图标依赖，但 cbw 仓库仍有第二层维护负担：

- 前端源码按早期通用模板拆得过细，很多 `types`、`constants`、`utils`、`view/subcomponents` 文件只有单一调用方，阅读核心业务流程时需要跨多层跳转。
- 后端保留了多轮迁移留下的兼容分支、诊断脚本和资源入口，部分脚本与 public 资源是否仍属于当前产品路径不够清楚。
- `shared/`、`src/` 内仍有少量 JS + `.d.ts` 手写类型配对，增加维护同步成本。
- 仓库里存在历史测试、脚本、资源和源码之间的日期前缀、legacy 兼容、PWA 清理等过渡痕迹，当前没有一条精简契约约束它们继续扩散。

这些问题不会马上造成运行失败，但会让后续变更更容易误改旧入口，也会让实际核心能力被历史结构淹没。

## 目标

在上一份 `29-移除TaskMaster和lucide图标依赖` 完成后，继续精简仓库的 tracked 源码、脚本和资源：

- 保持 cbw 的核心能力：项目、会话、聊天、文件、编辑器、Git、Shell、设置、Codex/OpenCode/Pi provider、oz/wo 工作流。
- 合并或删除只有单一调用方的前端薄层文件，减少为拆分而拆分的文件数量。
- 收敛后端兼容分支和脚本入口，让保留脚本都能从 `package.json`、README 或真实测试中追溯用途。
- 删除或合并已经没有静态入口引用的 public 资源和生成脚本。
- 将 JS + `.d.ts` 配对的共享工具优先转成 TS，或删除已经没有调用方的类型声明。
- 新增静态契约测试，防止被 `.gitignore` 忽略的运行态、缓存和本地工具状态被纳入精简范围。

## 范围

```text
前端源码精简
├─ 合并单一调用方的 view/subcomponents 薄组件
├─ 合并只服务单个组件的 types/constants/utils 文件
├─ 清理上一份提案执行后留下的 TaskMaster/tasks 空目录、i18n key 和 props 透传
├─ 转换或删除 src/shared 中 JS + .d.ts 的重复维护点
└─ 保留 chat/editor/file-tree/git/shell/workflow/settings 等真实业务边界

后端源码精简
├─ 删除上一份提案后无调用方的 TaskMaster/MCP 残余适配
├─ 收敛项目 read model、provider session、workflow metadata 的重复 helper
├─ 清理只为历史迁移服务且已有测试覆盖的新旧兼容分支
└─ 保留 oz/wo runner、项目发现、会话路由、Git/Shell API 的稳定契约

脚本和 public 资源精简
├─ 删除无入口引用的 icon/PWA 生成或清理脚本
├─ 审计 scripts/ 下每个脚本是否被 package/README/测试引用
├─ 对仍需手动运行的脚本补充明确入口或移动为测试辅助
└─ 不触碰 node_modules、dist、.wo、.taskmaster、.agents/cache 等 .gitignore 已忽略内容
```

## 非目标

- 不改动 `.gitignore` 已忽略的本地状态、缓存、数据库、构建产物或测试输出。
- 不删除 oz/wo 工作流、Codex/OpenCode/Pi provider、文件编辑器、Git、Shell、设置页等当前核心功能。
- 不为了减少文件数而把 chat、workflow、editor 这类复杂业务域合并成难维护的大文件。
- 不引入新的框架、图标库、构建工具或代码生成工具。
- 不在本提案阶段写测试占位文件；`tests/` 目录保留为空，执行阶段放真实测试代码。

## 测试意图

执行阶段需要新增或更新真实测试：

- 仓库精简边界契约测试：只扫描 `git ls-files` 的 tracked 文件，断言实现变更没有修改 `.gitignore` 已忽略路径。
- 脚本资源可追溯测试：`scripts/` 和 `public/` 中保留的脚本/资源必须被 `package.json`、README、入口 HTML、源码或测试引用；无引用项必须删除或移动到测试夹具。
- 前端精简回归测试：主工作区、聊天发送、文件树打开编辑器、Git 面板、Shell 面板、设置页和 workflow 详情仍能按用户路径工作。
- 后端精简回归测试：项目列表、项目详情、手动会话创建/续聊、workflow read model、runtime diagnostics 和 Git API 响应契约保持稳定。
- 静态源码契约测试：上一份提案执行后不得残留 TaskMaster/lucide 空壳入口；本提案新增或移动的源码文件必须保留文件目的说明和必要函数 docstring。
