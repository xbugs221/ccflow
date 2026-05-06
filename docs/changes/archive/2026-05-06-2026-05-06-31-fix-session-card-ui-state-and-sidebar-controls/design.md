# Design: 会话 UI 状态与左侧导航控件收敛

## 问题形态

```text
当前链路

右键会话卡片 -> 收藏
  -> PUT /sessions/:id/ui-state
  -> updateSessionUiState()
  -> 写 config.sessionUiStateByPath
  -> saveProjectConfig()
  -> normalizeProjectConfigForSave()
  -> 删除 sessionUiStateByPath
  -> refreshProjects()
  -> 会话卡片没有 favorite / hidden
```

需要改成：

```text
目标链路

右键会话卡片 -> 收藏 / 隐藏
  -> PUT /sessions/:id/ui-state
  -> updateSessionUiState()
  -> 定位 conf.json v2 chat record
  -> 写入 chat[route].ui
  -> refreshProjects()
  -> getSessions() / getCodexSessions()
  -> applySessionUiState()
  -> 项目主页卡片显示正确状态
```

## 数据模型

`conf.json` v2 下普通手动会话 UI 状态应落在顶层 `chat` 记录：

```json
{
  "chat": {
    "2": {
      "sessionId": "fixture-project-session",
      "title": "fixture-project session",
      "ui": {
        "favorite": true,
        "hidden": true
      }
    }
  }
}
```

工作流内部会话仍保留在 `workflows["N"].chat["M"].ui`。本 change 聚焦项目主页普通手动会话，但读取工具函数应兼容两类记录，避免未来右键菜单在项目内导航或 workflow 子会话中表现不一致。

## 后端方案

1. `getSessionUiStateMap(config)` 在 v2 模式下从 `chat[].ui` 和 `workflows[].chat[].ui` 构建 provider/path/session key。
2. `updateSessionUiState(projectName, sessionId, provider, uiState)` 在 v2 配置中优先定位已有 `chat` 或 workflow `chat` 记录。
3. 若找到记录，把 `favorite`、`pending`、`hidden` 写入该记录的 `ui` 字段。
4. 若所有 UI flag 都为 false，则删除该记录的 `ui` 字段。
5. 若遇到 legacy `sessionUiStateByPath`，保存前应合并进对应 v2 记录，避免归一化删除造成数据丢失。

## 前端方案

### 左侧导航职责

```text
左侧项目内导航
  ├─ 需求工作流
  │  └─ 点击切换
  └─ 手动会话
     └─ 点击切换

项目主页
  ├─ 排序
  ├─ 新建工作流
  ├─ 新建会话
  ├─ 多选 / 批量状态操作
  └─ 显示已隐藏项 / 取消隐藏
```

具体调整：

- `SidebarProjectWorkflows.tsx` 删除标题旁排序下拉框和“新建”按钮。
- `SidebarProjectWorkflows.tsx` 删除或停用 sidebar 内 workflow composer 状态和表单。
- `SidebarProjectSessions.tsx` 删除标题旁排序下拉框和“新建”按钮。
- 左侧列表可保持默认创建时间排序；favorite/pending 的优先级仍可保留，前提是不增加显式控件。

### 项目主页排序控件

项目主页保留排序下拉框，但增加稳定宽度和右侧 padding，避免文字与浏览器下拉箭头重叠：

```text
select
  ├─ min-width: 覆盖最长中文选项
  └─ padding-right: 留出原生下拉箭头区域
```

## 验收测试

建议补充 Playwright browser spec：

```text
项目主页 -> 右键会话卡片
  ├─ 点击 收藏
  │  └─ 卡片显示“收藏”，刷新后仍显示
  ├─ 再右键点击 隐藏
  │  └─ 卡片消失，出现“显示已隐藏项”
  ├─ 点击 显示已隐藏项
  │  └─ 隐藏会话出现
  └─ 右键点击 取消隐藏
     └─ 回到默认列表后该会话仍可见
```

另补静态或浏览器断言：

- 左侧 `manual-session-group` 不再包含 `手动会话排序` select。
- 左侧 `project-workflow-group` 不再包含 `工作流排序` select。
- 左侧分组标题旁不再存在“新建”按钮。
- 项目主页仍包含两个排序 select，且可选择 `created / updated / title / provider`。
