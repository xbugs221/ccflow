## 设计原则

ccflow 自有状态应和源码仓库分离。源码仓库只保存用户项目内容、`docs/changes` 提案和业务文件；Web 工作台的本机状态统一放进用户 state 目录。

目标路径：

```text
${XDG_STATE_HOME:-~/.local/state}/ccflow/
├─ conf.json
└─ repos/
   └─ <basename>-<sha1-10>/
      └─ conf.json
```

## 状态分类

```text
ccflow 自有状态
├─ 全局项目配置
│  └─ state/ccflow/conf.json
├─ 项目级 UI/路由状态
│  └─ state/ccflow/repos/<repo-key>/conf.json
├─ co request/state/events
│  └─ state/ccflow/co/                  # 已存在，不在本次迁移范围
└─ wo sealed workflow state
   └─ state/wo/repos/<repo-key>/...      # wo 所有，不在本次迁移范围
```

## 路径解析

新增集中路径模块，或扩展现有 `server/project-config-store.js`：

- `resolveCcflowStateRoot(env)`：
  - 优先 `XDG_STATE_HOME/ccflow`
  - Windows 可保留现有平台逻辑或显式走 home fallback
  - 默认 `~/.local/state/ccflow`
- `resolveProjectStateKey(projectPath)`：
  - `path.resolve(projectPath)`
  - basename 清洗为小写安全片段
  - SHA1 绝对路径取前 10 位
- `getProjectConfigPath(projectPath)`：
  - 有 projectPath 时返回 state repo config
  - 无 projectPath 时返回 global state config

## 迁移策略

读取顺序：

```text
1. 新 state config 存在 -> 直接读取
2. 新 state config 不存在，旧路径存在 -> 读取旧路径，规范化后写入新路径
3. 两者都不存在 -> 返回空 config
```

写入策略：

```text
只写新 state config。
不再创建 <project>/.ccflow。
不主动删除旧路径。
```

旧路径：

```text
项目级: <project>/.ccflow/conf.json
全局级: ~/.ccflow/conf.json
```

## 行为保持

迁移后这些业务行为必须保持：

- 手动会话继续使用稳定 `/cN` 路由。
- manual draft 在第一条消息前后仍能绑定 provider session id。
- `findProjectChatRecord` 仍能通过 provider session id 反查 `cN` route。
- 会话标题、favorite/hidden/pending、model/reasoning 设置不丢失。
- 项目列表仍能读取手动添加项目和 display name。

## 风险和取舍

- 旧 `.ccflow` 不删除，避免误删用户状态；代价是磁盘上可能保留旧目录。
- repo-key 绑定绝对路径，项目移动后会生成新状态路径；这是本机 state 的合理取舍，后续可加显式迁移或诊断。
- 全局 config 和项目级 config 迁移必须分开测试，因为无 projectPath 时路径语义不同。
- `co` 轮询成本问题和本提案正交，拆分可以降低迁移风险。

## 测试策略

执行阶段应在本提案 `tests/` 中先写真实测试代码，再同步到根测试目录：

- Node server 单测覆盖 `XDG_STATE_HOME` 下的全局和项目级路径解析。
- Node server 单测覆盖旧 `.ccflow/conf.json` 到 state config 的首次读迁移。
- Node server 单测覆盖新建 manual session draft 不创建项目内 `.ccflow`。
- Node server 单测覆盖两个同 basename 项目互不污染。
- 业务级测试覆盖 `/api/projects` 读取迁移后的 route/session metadata。
