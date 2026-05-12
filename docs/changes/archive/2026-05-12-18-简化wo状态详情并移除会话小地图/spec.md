## 新增需求

### 需求：工作流详情页必须使用 wo 0.9 固定角色行展示进度

工作流详情页必须把多轮 `execution/fix_N/review_N/archive` 汇总成接近 `wo status -w1` 的固定角色行，而不是把每一轮作为主进度列表项展开。

#### 场景：多轮修复和审核折叠成固定角色行

- **给定** `state.json` 包含 `execution`、多个 `fix_N`、多个 `review_N`
- **当** 用户打开该 workflow 详情页
- **则** 主进度区域必须展示固定角色行 `规`、`写`、`审`、`存`
- **且** `写` 行必须用勾数量表示 execution 和 fix 发生次数
- **且** `审` 行必须用勾数量表示 review 发生次数
- **且** 页面不得把 `1 fix review`、`2 fix review` 等每轮文案作为主进度列表逐条展开

#### 场景：归档阶段展示存行

- **给定** `state.json` 包含已完成的 `archive` 阶段
- **且** `sessions` 中包含 `codex:archiver`
- **当** 用户打开 workflow 详情页
- **则** `存` 行必须可见
- **且** `存` 行必须展示一个归档次数勾
- **且** `存` 行的会话链接必须指向 archiver 子会话

#### 场景：规划会话未知时保持可读

- **给定** `state.json` 没有 planning 会话
- **当** 用户打开 workflow 详情页
- **则** `规` 行必须展示为 `未知` 或等价不可点击状态
- **且** 页面不得为该行生成无效子会话链接

### 需求：固定角色行必须保留可点击子会话入口

用户仍然可以从工作流详情页进入写、审、存对应的真实会话内容。

#### 场景：点击写行进入 executor 会话

- **给定** `写` 行匹配到 `codex:executor` 会话
- **当** 用户点击 `写` 行中的会话链接
- **则** 页面必须进入该 workflow 的 executor child session 路由
- **且** 聊天区域必须展示该会话的真实消息内容

#### 场景：点击审行进入 reviewer 会话

- **给定** `审` 行匹配到 `codex:reviewer` 会话
- **当** 用户点击 `审` 行中的会话链接
- **则** 页面必须进入该 workflow 的 reviewer child session 路由
- **且** 聊天区域必须展示该会话的真实消息内容

#### 场景：缺失会话的角色行不可点击

- **给定** 某个角色行没有匹配到 child session
- **当** 用户打开 workflow 详情页
- **则** 该行仍必须可见
- **且** 该行不得渲染会触发无效路由的按钮或链接

### 需求：workflow child session 不得显示右上流程图小地图

用户进入 workflow child session 后，页面必须专注展示聊天内容，不再出现浮动流程图小地图。

#### 场景：进入子会话后没有小地图

- **给定** 用户已从 workflow 详情页点击角色行进入 child session
- **当** child session 页面加载完成
- **则** 页面必须展示对应聊天消息
- **且** 页面不得出现 `workflow-minimap`
- **且** 页面不得出现 `workflow-minimap-drag-handle`
- **且** 页面不得出现 `workflow-stage-tree-preview`

#### 场景：手动会话仍不受工作流小地图影响

- **给定** 用户打开普通手动会话
- **当** 会话页面加载完成
- **则** 页面必须展示普通聊天消息
- **且** 页面不得出现 workflow 小地图或流程图预览

### 需求：ccflow 不得解析 wo status 人类文本

ccflow 必须继续以 `state.json` 为 runner fact 来源，避免把 `wo status -w1` 的中文输出当成稳定协议解析。

#### 场景：从 state.json 生成固定角色行

- **给定** 用户状态目录中存在 0.9 风格 `state.json`
- **当** ccflow 构建 workflow read model
- **则** read model 必须从 `stages` 和 `sessions` 汇总固定角色行
- **且** 构建过程不得调用或解析 `wo status -w1`
- **且** 缺失人类输出文本不得影响 workflow 详情页展示
