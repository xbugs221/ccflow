归档已完成的变更，若无法从上下文中判断，运行 `openspec list` 获取可用变更

运行 `openspec status --change "<name>" --json` 检查 artifact 完成情况。

解析 JSON 以了解：

- `schemaName`：所用工作流
- `artifacts`：artifact 列表及其状态（`done` 或其他）

**若有 artifact 未完成：**

- 显示警告，列出未完成的 artifact
- 请求用户确认是否继续
- 用户确认后继续

读取任务文件（通常为 `tasks.md`），检查是否有未完成任务。

统计 `- [ ]`（未完成）与 `- [x]`（已完成）的数量。

**若存在未完成任务：**

- 显示警告，说明未完成任务数量
- 请求用户确认是否继续
- 用户确认后继续

**若不存在任务文件：** 直接继续，无需任务相关警告。

检查 `openspec/changes/<name>/specs/` 下是否有 delta specs，若无则直接继续。

**若存在 delta specs：**

- 将每个 delta spec 与 `openspec/specs/<capability>/spec.md` 中对应的主 spec 对比
- 确定将应用的变更（新增、修改、删除、重命名）
- 显示综合摘要，直接开始同步，不必询问

若不存在则创建归档目录：

```bash
mkdir -p openspec/changes/archive
```

使用当前日期生成目标名称：`YYYY-MM-DD-<change-name>`

**检查目标是否已存在：**

- 若存在：报错，建议重命名现有归档或使用不同日期
- 若不存在：移动变更目录到归档

```bash
mv openspec/changes/<name> openspec/changes/archive/YYYY-MM-DD-<name>
```

显示归档完成摘要，包括：

- 变更名称
- 所用 schema
- 归档位置
- Spec 同步状态（已同步 / 跳过同步 / 无 delta specs）
- 任何警告说明（未完成的 artifact/任务）

整理关联的变动为一个commit

**约束**

- 使用openspec status --json检查完成状态
- 警告不阻止归档，仅提示并确认
- 移动目录时保留 .openspec.yaml（随目录一起移动）
- 清晰展示操作摘要
