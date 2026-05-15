## 问题

ccflow 现在会把项目级 UI 状态写入项目内 `.ccflow/conf.json`。这些数据包括手动会话 `cN` 路由、provider session 绑定、会话标题、模型设置、UI 状态和 manual draft 状态。它们属于本机 Web 工作台运行状态，不是项目源码事实。

项目内 `.ccflow` 会带来几个问题：

- 污染用户仓库工作区，容易出现在 Git status 中。
- 同一源码目录在不同机器上会混入不同用户的本地 UI 状态。
- ccflow 已经把 `co` 和 `wo` 的运行态放到用户 state 目录，`.ccflow` 继续留在项目内会让状态边界不一致。

## 目标

把 ccflow 自有状态统一迁移到 XDG state 目录：

```text
${XDG_STATE_HOME:-~/.local/state}/ccflow/
├─ conf.json
└─ repos/
   └─ <repo-key>/
      └─ conf.json
```

`<repo-key>` 由项目绝对路径生成，包含仓库 basename 和短 hash，避免同名仓库互相覆盖。

## 范围

- 新增 ccflow state root 和 repo-key 解析逻辑。
- 将项目级 `conf.json` 从 `<project>/.ccflow/conf.json` 迁移到 `${XDG_STATE_HOME:-~/.local/state}/ccflow/repos/<repo-key>/conf.json`。
- 将全局 `~/.ccflow/conf.json` 迁移到 `${XDG_STATE_HOME:-~/.local/state}/ccflow/conf.json`。
- 首次读取旧路径时兼容迁移，之后只写新路径。
- 保持现有 `cN` 路由、manual draft、会话标题、模型设置和 UI 状态行为不变。
- 更新 README 或相关文档，说明 `.ccflow` 不再是项目内运行态来源。

## 非目标

- 不迁移 `co` 协议目录；它已经在 `${CCFLOW_CO_HOME:-~/.local/state/ccflow/co}`。
- 不迁移 `wo` sealed state；它继续由 `wo` 写入 `${XDG_STATE_HOME:-~/.local/state}/wo/repos/...`。
- 不优化 `co` active turn 轮询和 conversation observer；该问题另起提案处理。
- 不删除用户已有项目内 `.ccflow` 目录，只停止后续写入并可提供诊断提示。
- 不改变项目源码、Git 面板、Shell、文件树或 workflow read model 的业务行为。

## 测试意图

执行阶段需要新增真实测试：

- server 配置路径测试：`XDG_STATE_HOME` 指向临时目录时，项目级 config 写入 state repo 目录，项目内不创建 `.ccflow`。
- 迁移测试：旧 `<project>/.ccflow/conf.json` 存在时，读取后生成新 state config，`cN` 路由和 session 绑定保持不变。
- 全局配置迁移测试：旧 `~/.ccflow/conf.json` 可迁移到 state root，并保持手动项目列表可读。
- repo-key 测试：两个同 basename 不同绝对路径项目生成不同 state 路径。
- 业务回归测试：新建手动 Codex/OpenCode 会话后刷新项目列表，仍能通过 `/cN` 路由打开同一会话。
