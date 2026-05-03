执行 OpenSpec 变更中的任务

```bash
openspec status "<name>" --json
```

解析 JSON 以了解：

- `schemaName`：所用工作流（如 "spec-driven"）
- 哪个 artifact 包含任务（spec-driven 通常是 "tasks"，其他 schema 参考 status 输出）

```bash
openspec instructions apply --change "<name>" --json
```

返回内容：

- 上下文文件路径（因 schema 而异）
- 进度（总数、已完成、剩余）
- 任务列表及状态
- 基于当前状态的动态指令

---

**状态处理：**

- `state: "blocked"` 缺少 artifact
- `state: "all_done"`：恭喜完成，建议归档
- 其他：继续执行实现

读取 apply 指令输出中 `contextFiles` 列出的文件，依 schema 而定：

- **spec-driven**：proposal、specs、design、tasks
- 其他 schema：按 CLI 输出的 contextFiles 处理

显示：

- 所用 schema
- 进度："N/M 任务已完成"
- 剩余任务概览
- CLI 的动态指令

对每个待处理任务：

- 说明正在处理哪个任务
- 进行必要的代码修改
- 保持改动最小且聚焦
- 在任务文件中标记完成：`- [ ]` → `- [x]`
- 继续下一个任务

---

**以下情况暂停：**

- 任务不明确 → 请求澄清
- 实现过程发现设计问题 → 建议更新 artifact
- 遇到错误或阻塞 → 上报并等待指引
- 用户中断

显示：

- 本次会话完成的任务
- 总体进度："N/M 任务已完成"
- 全部完成时：建议归档
- 暂停时：说明原因并等待指引

**暂停时的输出（遇到问题）**

```
## 实现已暂停

**变更：** <change-name>
**Schema：** <schema-name>
**进度：** 4/7 任务完成

### 遇到的问题
<问题描述>

**选项：**
1. <选项 1>
2. <选项 2>
3. 其他方案

您希望如何处理？
```

**约束**

- 持续处理任务直到完成或阻塞
- 开始前始终读取上下文文件（来自 apply 指令输出）
- 实现过程发现问题时暂停并建议更新 artifact
- 仅作必要更改，聚焦于各自任务
- 完成每个任务后立即更新任务复选框
- 遇到错误、阻塞或需求不明时暂停，不要猜测，小问题自行做主尝试解决
- 使用 CLI 输出中的 contextFiles，不要假设具体文件名
