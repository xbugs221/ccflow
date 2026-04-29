# 工作流/会话卡片 UI 改造方案

## 需求

1. 左侧导航栏工作流/会话卡片风格与项目主页保持一致（侧边栏尺寸缩小版）
2. 工作流卡片取消"标为已读"按钮
3. 工作流阶段由文字改为对应 icon，横向排列
4. 阶段 icon 着色规则：默认灰色、正在执行蓝色、已完成绿色

## 现状分析

### 项目主页工作流卡片（ProjectOverviewPanel）

- 容器：`min-h-[132px] flex-col rounded-md border p-4` 卡片式
- 顶部：状态 icon（CheckCircle2/Circle）+ `line-clamp-2` 标题
- 底部标签行：收藏 badge、待办 badge、`workflow.stage` 文字、`workflow.runState` 文字、未读绿点
- 底部按钮区：条件渲染"标记已读"按钮

### 项目主页会话卡片（ProjectOverviewPanel）

- 容器：`min-h-[132px] rounded-md border` 卡片式
- 顶部：会话名称 + ProviderLogo
- 中部：相对时间
- 底部标签：未读黄点、routeNumber、收藏 badge、待办 badge、消息数

### 侧边栏工作流卡片（SidebarProjectWorkflows）

- 容器：`w-full rounded-md border px-3 py-2` 紧凑型按钮
- 单行行布局：标题 + 底部 icon 行（Star、Clock、`stage` 文字、状态圆点）
- 与主页卡片风格差异大（无 min-height、无卡片感、无标题换行）

### 侧边栏会话卡片（SidebarSessionItem）

- 容器：border 按钮，px-3 py-2
- 顶部：routeNumber + 会话名
- 底部：Star、Clock、ProviderLogo、时间、消息数
- 有未读黄点（绝对定位左侧）

### 阶段数据结构

- `workflow.stageStatuses: WorkflowStageStatus[]`，每项含 `key` / `label` / `status`
- 阶段 key（按线性顺序）：`planning` → `execution` → `review_1` → `repair_1` → `review_2` → `repair_2` → `review_3` → `repair_3` → `archive`
- 状态值：`completed` | `ready` | `skipped` | `active` | `running` | `blocked` | `failed` | `pending`

## 成果

- 主页与侧边栏工作流卡片视觉风格统一，仅尺寸/字号差异
- 新增可复用的 `WorkflowStageProgress` 阶段进度条组件
- "标为已读"按钮从项目主页工作流卡片中移除
- 阶段文字标签替换为横向 icon 进度条，按状态着色
- 会话卡片在两侧边栏中保持风格一致（缩小版主页卡片）

## 做法

### 一、新增可复用组件：`src/components/workflow/WorkflowStageProgress.tsx`

```tsx
/**
 * PURPOSE: 以横向 icon 序列展示工作流各阶段进度状态。
 * 适用于项目主页卡片和侧边栏卡片的底部阶段指示区。
 */
```

**Props 设计：**

```ts
interface WorkflowStageProgressProps {
  stageStatuses: WorkflowStageStatus[];
  size?: 'sm' | 'md';   // sm 用于侧边栏，md 用于主页
}
```

**阶段 → Icon 映射表：**

| stageKey | lucide icon | 语义 |
|---|---|---|
| `planning` | `FileText` | 规划 |
| `execution` | `Play` | 执行 |
| `review_1` / `review_2` / `review_3` | `Eye` | 审核（多轮共用同一 icon，以位置区分轮次） |
| `repair_1` / `repair_2` / `repair_3` | `Wrench` | 修复（多轮共用同一 icon，以位置区分轮次） |
| `archive` | `Archive` | 归档 |
| 其他未知 key | `Circle` | 兜底 |

**状态 → 颜色映射：**

| 状态 | Tailwind 类 | 视觉 |
|---|---|---|
| `completed` / `ready` / `skipped` | `text-green-500` | 绿色（已完成） |
| `active` / `running` / `blocked` / `failed` | `text-blue-500` | 蓝色（当前/进行中） |
| `pending` | `text-muted-foreground/40` | 灰色（未开始） |

**布局：**

- `flex items-center gap-1` 横向排列
- 每个 icon 带 `title="${label}: ${status}"` 悬浮提示
- sm 尺寸：`h-3 w-3`，md 尺寸：`h-4 w-4`
- 阶段之间可加极细竖线 `|` 或 `w-px h-3 bg-border` 分隔，增强可读性（可选）

### 二、改造项目主页工作流卡片（ProjectOverviewPanel:879-945）

**删除项：**

1. 底部标签行中的 `<span className="rounded-md bg-muted px-2 py-1">{workflow.stage}</span>`
2. 底部标签行中的 `<span className="rounded-md bg-muted px-2 py-1">{workflow.runState}</span>`
3. 条件渲染的整段"标记已读"按钮（`workflow.hasUnreadActivity && onMarkWorkflowRead` 区块）

**新增项：**

- 在底部标签行（`mt-auto flex flex-wrap items-center gap-2` 区域）插入 `<WorkflowStageProgress stageStatuses={workflow.stageStatuses} size="md" />`
- 保留收藏 badge、待办 badge、未读绿点

### 三、改造侧边栏工作流卡片（SidebarProjectWorkflows:473-546）

**结构对齐为主页缩小版：**

- 将当前扁平按钮改为 flex-col 卡片式结构（与主页一致）
- 顶部保留状态指示（可沿用现有的绿色/琥珀色圆点，或对齐主页的 CheckCircle2/Circle）
- 标题行：`truncate text-xs font-medium text-foreground`（已有，保留）
- 底部信息行改为标签式布局，与主页对齐

**删除项：**

- `<span>{workflow.stage}</span>` 文字标签
- 现有的状态圆点 `workflowFinished ? 'bg-emerald-500' : 'bg-amber-500'`（由阶段进度条替代整体状态表达）

**新增项：**

- 底部插入 `<WorkflowStageProgress stageStatuses={workflow.stageStatuses} size="sm" />`
- 收藏/待办保持为 compact icon（当前已有 Star/Clock，与主页 badge 风格不同但侧边栏空间受限，建议保持现有 icon 形式）

### 四、会话卡片风格对齐（简要）

**SidebarSessionItem 改造要点：**

- 将当前列表式布局调整为缩小版主页会话卡片结构
- 保持 `border rounded-md px-3 py-2` 但内部改为 flex-col gap 布局
- 顶部：会话名称 + ProviderLogo（右对齐）
- 中部：时间
- 底部标签行：未读指示、routeNumber、Star、Clock、消息数
- 未读黄点从绝对定位改为标签行内展示（与主页对齐）
- 移动端编辑态保持现有行为不变

### 五、阶段数据来源的健壮性处理

`workflow.stageStatuses` 为后端必返字段，但需考虑老数据兼容：

- 若 `stageStatuses` 为空数组，进度条组件返回 `null`（不渲染阶段区）
- 映射表中未识别的 key 使用 `Circle` 兜底，避免渲染异常

### 六、颜色方案与现有设计对比

| 场景 | 现有颜色 | 新颜色 |
|---|---|---|
| 已完成 | `text-emerald-500` / `text-green-600` | `text-green-500`（统一） |
| 进行中（active） | `text-amber-500` / `bg-amber-500` | `text-blue-500`（用户指定） |
| 未开始 | `text-muted-foreground` / `bg-slate-300` | `text-muted-foreground/40` |

注意：`WorkflowDetailView` 中的树状阶段视图（`renderTodoMarker` 等）保持现有绿/黄/灰三色不变，本次改造仅影响卡片级别的阶段进度条。避免大范围颜色不一致。

### 七、改造文件清单

| 文件 | 改动类型 |
|---|---|
| `src/components/workflow/WorkflowStageProgress.tsx` | 新增 |
| `src/components/main-content/view/subcomponents/ProjectOverviewPanel.tsx` | 修改（工作流卡片底部标签区 + 移除标记已读按钮） |
| `src/components/sidebar/view/subcomponents/SidebarProjectWorkflows.tsx` | 修改（工作流卡片结构调整 + 阶段进度条） |
| `src/components/sidebar/view/subcomponents/SidebarSessionItem.tsx` | 修改（风格对齐主页会话卡片，缩小版） |
