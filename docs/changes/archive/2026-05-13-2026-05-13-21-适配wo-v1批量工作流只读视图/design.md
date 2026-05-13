## 总体设计

工作流前端的信息架构调整为：

```text
主对象：run / 提案
辅助对象：batch / 批量上下文

自动工作流
├─ 批量任务 b1 running 2/2
│  ├─ 47-重设Skill运行规则契约
│  │  └─ 规 / 写 / 审 x5 / 修 x4 / 存
│  └─ 48-空token启用Gateway免登录
│     └─ 规 / 写
└─ 单独运行
   └─ 2026-05-13-xx-某提案
      └─ 规 / 写 / 审 / 修 / 存
```

原则：

- batch 只负责分组、顺序和总进度。
- run 负责详情、会话、产物和跳转。
- artifact/session 永远归属具体 run。
- 第一版只读，不提供任何前端干预能力。

## 后端 read model

### batch 读取

新增或扩展 wo read model，使其读取：

```text
~/.local/state/wo/repos/<repo>/batches/<batchId>/state.json
```

batch state 至少提供：

- `batch_id`
- `status`
- `changes`
- `current_index`
- `run_ids`
- `error`

read model 输出可供前端使用的 batch 摘要：

```text
{
  id,
  displayId,       // 例如 b1，由排序后的批量列表推导
  status,
  currentIndex,
  total,
  runIds,
  error
}
```

每个子 run 同时保留：

- `batchId`
- `batchDisplayId`
- `batchIndex`
- `batchTotal`
- `batchStatus`

这样详情页可以展示 `自动工作流 / b1 / 48-空token启用Gateway免登录`，但仍使用 `/runs/<runId>` 路由。

### 五阶段映射

run read model 将阶段归并为五个用户可见角色：

```text
规 planning
写 execution
审 review_N
修 fix_N / repair_N
存 archive
```

会话解析必须支持 provider 前缀：

```text
codex:executor
codex:reviewer
codex:fixer
codex:archiver
opencode:archiver
pi:executor
```

处理规则：

- `executor` 映射到 `写`。
- `reviewer` 映射到 `审`。
- `fixer` 映射到 `修`。
- `archiver` 映射到 `存`。
- `planning` 或缺失 planning 会话时，`规` 显示“工作流开始之前就已完成”。
- provider 不可被 ccflow 打开时，保留阶段状态，但不渲染会跳转失败的会话链接。

### 固定产物发现

除 `state.paths` 外，read model 还应扫描 run 目录中的固定产物：

```text
runs/<runId>/review-1.json
runs/<runId>/review-2.json
runs/<runId>/fix-1.json
runs/<runId>/repair-1.json
```

产物输出时使用绝对路径或受控 artifact 引用，确保前端点击后可以直接打开内容。产物仍标记所属阶段：

- `review-N.json` 属于 `review_N`
- `fix-N.json` 属于 `fix_N`
- `repair-N.json` 属于 `repair_N`

角色摘要只显示当前最大轮次产物，历史轮次在详情产物区可见。

## 前端布局

### 自动工作流总览

替换当前平铺卡片思路，改为工作流总览列表：

```text
[筛选: 全部 / 运行中 / 阻塞 / 已完成] [按批量分组]

批量任务 b1      running 2/2
  47-重设Skill运行规则契约      done
    规 ✓  写 ✓  审 x5 ✓  修 x4 ✓  存 ✓
  48-空token启用Gateway免登录  running
    规 ✓  写 →

单独运行
  2026-05-13-xx-某提案
    规 ✓  写 ✓  审 x1 ✓
```

交互：

- 点击 batch header：展开或收起子 run。
- 点击 run 行：进入 `/runs/<runId>` 详情。
- batch header 不进入单独详情页。
- 不显示 batch 操作按钮。

### run 详情页

run 详情页顶部显示：

```text
自动工作流 / b1 / 48-空token启用Gateway免登录

状态: running
批量: b1 2/2
阶段: 写
更新时间: ...
```

主体展示：

```text
规  工作流开始之前就已完成   ✓
写  会话                    →
审  review-2.json           ✓✓
修  会话 fix-1.json         ✓
存  会话                    ✓
```

会话按钮统一使用短文本，例如 `会话`，完整 session id 放在 title 或诊断区，不直接暴露在主要页面正文。

### 手动会话过滤

过滤应优先在后端完成，前端保留兜底：

```text
manual sessions = provider sessions
  - workflow childSessions
  - workflow runnerProcesses.sessionId
  - workflow role sessions from state.sessions
  - workflow owned draft/session metadata
  - likely workflow auto sessions
```

这能避免工作流自动发起的 Codex/OpenCode/Pi 会话卡片出现在“手动会话”区域。

## 风险和取舍

- batch 只读能避免错误修改 sealed state，但用户不能从前端中止批量任务；后续如需干预，应通过 wo 稳定命令并加确认。
- 以 run 为详情单位会让 batch 详情较轻，但 artifact/session 归属最清楚。
- 扫描 run 目录固定产物需要限制文件名模式，避免把无关 state 文件暴露给前端。
- `pi:*` provider 的打开方式需要谨慎；无法确认时不应生成坏链接。

## 测试策略

执行阶段应新增或更新这些真实业务测试：

- server read-model 测试：构造 batch state 和两个子 run，断言 batch 摘要、子 run batch 字段和排序正确。
- server read-model 测试：构造 v1.0.1 `sessions`，断言 `fixer` 进入 `修` 行，`opencode:archiver` 进入 `存` 行。
- server read-model 测试：`paths` 为空但 run 目录存在 `review-1.json` / `fix-1.json` 时，read model 输出可打开 artifact。
- Playwright 测试：项目总览按 batch 只读分组展示 `b1 running 2/2`，点击子 run 进入详情。
- Playwright 测试：run 详情显示五阶段、会话短链接、当前轮次产物链接，点击 JSON 后能查看内容。
- Playwright 或 server 测试：手动会话区域过滤工作流发起的会话，只保留用户手动创建的会话卡片。
