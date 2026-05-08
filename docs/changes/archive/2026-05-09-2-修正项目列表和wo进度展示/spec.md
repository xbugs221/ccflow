## 新增需求

### 需求：工作流主进度必须以 wo 输出为准

系统必须把 `wo` 的人类可读输出作为 workflow 主进度展示语义，不得按前端偏好改写阶段文案。

#### 场景：直接使用 workflow_display.lines

- **当** `.wo/runs/run-a/state.json` 包含 `workflow_display.lines`
- **且** 其中一行为 `{"marker":"✓","text":"1 fix review","stage_key":"review_2"}`
- **则** workflow 详情页必须显示 `✓ 1 fix review`
- **且** 不得显示 `review 2`
- **且** 不得显示 `复审 1`
- **且** 不得显示其他前端自造文案

#### 场景：缺少 workflow_display 时按 wo 文本 fallback

- **当** `.wo/runs/run-a/state.json` 不包含 `workflow_display.lines`
- **且** `stages` 表示 `repair_1` 已完成、`review_2` 正在运行
- **则** 后端 read model 必须生成 `✓ 1 fix` 和 `→ 1 fix review`
- **且** 这些文本必须与 `wo` 程序输出语义一致

### 需求：支持任意已发生的多轮 review 和 repair

系统必须支持 `wo` 状态中出现超过三轮的合法 review / repair 阶段。

#### 场景：六轮 review 五轮 repair 正确排序

- **当** `.wo/runs/run-a/state.json` 的 `stages` 包含 `review_1` 到 `review_6`
- **且** 包含 `repair_1` 到 `repair_5`
- **且** 所有这些阶段均已 completed
- **则** workflow 主进度必须按 `start -> review -> 1 fix -> 1 fix review -> 2 fix -> 2 fix review -> 3 fix -> 3 fix review -> 4 fix -> 4 fix review -> 5 fix -> 5 fix review` 的顺序展示
- **且** `4 fix`、`5 fix` 不得出现在 `archive` 之后
- **且** diagnostics 不得包含 `Unknown runner stage: review_4`
- **且** diagnostics 不得包含 `Unknown runner stage: repair_4`

#### 场景：archive 排在所有已发生循环之后

- **当** `stages` 同时包含多轮 review / repair 和 `archive`
- **则** `archive` 必须排在所有已发生的 review / repair 循环之后

#### 场景：done 不是普通阶段

- **当** `.wo/runs/run-a/state.json` 包含 `status = "done"` 或 `stage = "done"`
- **则** workflow 顶部状态必须表达该 run 已完成
- **且** 主进度不得因为 `stage = "done"` 自行增加一行 `done`
- **且** diagnostics 不得把 `done` 当作未知 runner stage 警告

### 需求：项目导航不得显示不可区分的测试残留项目

系统必须避免把 Codex 测试临时目录残留显示为多个不可区分的普通项目。

#### 场景：过滤无业务数据的 Codex 测试临时项目

- **当** Codex 配置中存在 `/tmp/TestRunJSONErrorsCoverRequiredFailureModes3832776911/001`
- **且** 该项目没有 Claude/Codex/OpenCode 会话
- **且** 该项目没有 `.wo/runs` workflow
- **则** `/api/projects` 不得把该项目作为普通项目返回
- **且** 左侧导航不得显示该 `001`

#### 场景：保留有业务数据的临时项目但必须可区分

- **当** 两个不同项目路径的 basename 都是 `001`
- **且** 它们至少一个不能被过滤
- **则** 左侧导航必须显示可区分的项目名称或短路径
- **且** 点击任意一个项目时必须进入对应项目路径
- **且** 不得只显示两个完全相同的 `001`

### 需求：测试覆盖真实业务行为

系统必须用真实 read model 和浏览器行为测试本次修复。

#### 场景：server read model 覆盖多轮 wo 状态

- **当** server 测试构造包含六轮 review / 五轮 repair 的 `.wo/runs/run-a/state.json`
- **则** `listWoWorkflowReadModels` 必须返回正确排序的 `workflowDisplay.lines`
- **且** 不得产生合法多轮阶段的 unknown warning

#### 场景：浏览器展示不再出现重复 001 项目

- **当** 测试项目列表包含多个 `/tmp/Test.../001` 测试残留
- **则** 浏览器左侧项目导航不得出现多个不可区分的 `001`
